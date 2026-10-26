import { Router } from 'express';
import { asyncHandler } from '../asyncHandler.js';
import { entityInfo } from '../modules/entities.js';
import pool from '../db.js';
import { loadConfig, getModule } from '../config.js';
import { complete, translateMany, checkRateLimit, extractJson } from '../cortex.js';
import { isIdent } from '../sqlGuard.js';

const router = Router();

const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
const userOf = (req: { headers: Record<string, unknown> }) => String(req.headers['x-mdm-user'] || '');

// Fields the AI must never fill: system columns and identifiers that would be invented
const SYSTEM_FIELDS = new Set(['id', 'golden_id', 'source_system', 'source_id', 'created_at', 'created_by', 'updated_at',
  'updated_by', 'is_deleted', 'hierarchy_path', 'hierarchy_level', 'last_dq_check', 'dnb_enriched', 'dnb_enriched_at',
  'extended_attrs', 'completeness', 'dq_score', 'lifecycle_stage', 'parent_id', 'category_id', 'translations', 'assets',
  'primary_image', 'certifications']);
const INVENTED_IDS = /(^|_)(tax|vat|duns|siren|siret|sku|ean|gtin|iban|bic|registration)(_|$)/;

// POST /api/ai/translate-batch — translate multiple fields at once
router.post('/translate-batch', asyncHandler(async (req, res) => {
  const { fields, from_lang, to_lang } = req.body;
  if (!fields || typeof fields !== 'object' || !LANG_RE.test(to_lang || '') || (from_lang && !LANG_RE.test(from_lang))) {
    res.status(400).json({ error: 'fields and a valid to_lang (e.g. "fr") are required' }); return;
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    // Keys become column aliases in the generated SQL
    if (!isIdent(k)) { res.status(400).json({ error: `Invalid field name: ${String(k).slice(0, 64)}` }); return; }
    if (typeof v === 'string' && v.trim()) values[k] = v;
  }
  if (Object.keys(values).length === 0) { res.json({ translations: {} }); return; }
  const user = userOf(req);
  checkRateLimit(user);
  const translations = await translateMany({ user, endpoint: 'ai/translate-batch' }, values, from_lang || '', to_lang);
  res.json({ translations });
}));

// POST /api/ai/suggest/:moduleId — suggest values for empty fields of a new record.
// The prompt is built server-side from module config; only active, non-system fields come back.
router.post('/suggest/:moduleId', asyncHandler(async (req, res) => {
  const mod = getModule(req.params.moduleId);
  if (!mod?.enabled) { res.status(404).json({ error: 'Module not found' }); return; }
  const known = (req.body?.fields || {}) as Record<string, unknown>;
  const active = mod.fields.filter(f => f.active !== false && !SYSTEM_FIELDS.has(f.name));
  const nameValue = String(known[mod.name_field] ?? '').trim();
  if (!nameValue) { res.status(400).json({ error: `Enter ${mod.name_field} first` }); return; }

  const presentFields: Record<string, string> = {};
  const targets: typeof active = [];
  for (const f of active) {
    const v = known[f.name];
    if (v !== undefined && v !== null && String(v).trim() !== '') presentFields[f.name] = String(v).slice(0, 500);
    else if (!INVENTED_IDS.test(f.name)) targets.push(f);
  }
  if (targets.length === 0) { res.json({ suggestions: {} }); return; }

  // Allowed values for codelist-backed fields
  const domains = [...new Set(targets.map(f => f.ref_domain).filter((d): d is string => !!d))];
  const codes = new Map<string, string[]>();
  if (domains.length) {
    const r = await pool.query('SELECT domain, code FROM mdm.ref_codelist WHERE domain = ANY($1) AND is_active ORDER BY sort_order NULLS LAST, code', [domains]);
    for (const row of r.rows) codes.set(row.domain, [...(codes.get(row.domain) || []), row.code]);
  }
  const fieldLines = targets.map(f => {
    const allowed = f.ref_domain && codes.get(f.ref_domain)?.length ? ` (one of: ${codes.get(f.ref_domain)!.join('|')})` : '';
    const len = f.max_length ? ` (max ${f.max_length} chars)` : '';
    const kind = f.type === 'number' ? ' (number)' : f.name === 'country_code' ? ' (ISO 3166 alpha-3)' : '';
    return `- ${f.name}: ${f.label || f.name}${kind}${allowed}${len}`;
  }).join('\n');

  const prompt = `You are an MDM data steward for ${loadConfig().llmContext}.
A user is creating a new ${mod.singular || mod.label} record.
KNOWN VALUES:
${JSON.stringify(presentFields, null, 2)}

Suggest realistic values for these EMPTY fields:
${fieldLines}

Only include fields you can reasonably infer. Never invent identifiers (tax, registration, SKU, EAN numbers).
Return ONLY a JSON object with field names as keys, no markdown.`;

  const user = userOf(req);
  checkRateLimit(user);
  const raw = await complete({ user, endpoint: `ai/suggest/${mod.id}` }, prompt);
  const parsed = extractJson<Record<string, unknown>>(raw) || {};
  const allowedKeys = new Set(targets.map(f => f.name));
  const suggestions: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (allowedKeys.has(k) && v !== null && v !== undefined && String(v).trim() !== '') suggestions[k] = String(v);
  }
  res.json({ suggestions });
}));

// POST /api/ai/remediate — suggest corrections and fill missing fields for entity data
router.post('/remediate', asyncHandler(async (req, res) => {
  const { entity_type, entity_data, issues } = req.body;
  if (!entity_data || typeof entity_data !== 'object') { res.status(400).json({ error: 'entity_data required' }); return; }

  const entityLabel = entityInfo(entity_type).type;
  const data = entity_data as Record<string, unknown>;

  const emptyFields: string[] = [];
  const presentFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SYSTEM_FIELDS.has(k) || !isIdent(k)) continue;
    if (v === null || v === '' || v === undefined) emptyFields.push(k);
    else presentFields[k] = typeof v === 'string' ? v.slice(0, 1000) : v;
  }

  const prompt = `You are an MDM data steward AI for ${loadConfig().llmContext}.
Your task is to FILL IN missing fields and FIX incorrect fields for this ${entityLabel} record.

KNOWN DATA:
${JSON.stringify(presentFields, null, 2)}

EMPTY FIELDS THAT NEED VALUES:
${emptyFields.map(f => `- ${f}`).join('\n')}
${typeof issues === 'string' && issues ? `\nKnown issues:\n${issues.slice(0, 2000)}` : ''}

INSTRUCTIONS:
1. For each empty field listed above, provide the correct value using your knowledge of this company/product.
   - For well-known companies: fill headquarters address, phone, email, website, tax ID, DUNS, industry codes, trade names, segment.
   - For products: fill EAN, descriptions, weight, hazardous status, ESG rating if known.
2. Also fix any formatting issues in existing fields (proper case, international phone format +XX ..., etc).
3. Use these conventions:
   - Phone: international format like +34 900 100 100
   - Email: generic corporate contact like info@domain.com or contact@domain.com
   - Website: https://www.domain.com
   - Industry codes: use NACE/ISIC codes
4. Do NOT include id, source_system, source_id, golden_id, lifecycle_stage, or any timestamp fields.
5. Return ONLY a valid JSON object with the field names as keys. Include ALL empty fields you can fill plus any corrections to existing fields.
6. If you cannot determine a value with reasonable confidence, omit that field.
7. Return ONLY the JSON object — no markdown fences, no explanation, no comments.`;

  const user = userOf(req);
  checkRateLimit(user);
  const raw = await complete({ user, endpoint: 'ai/remediate' }, prompt);
  const suggestions = extractJson<Record<string, unknown>>(raw) || {};
  for (const key of Object.keys(suggestions)) if (SYSTEM_FIELDS.has(key) || !isIdent(key)) delete suggestions[key];

  res.json({ suggestions });
}));

export default router;
