import { Router } from 'express';
import pool, { getAppUser, userDb, withUser } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { complete, embed, checkRateLimit } from '../cortex.js';
import { assertIdent } from '../sqlGuard.js';
import { getEnabledModules } from '../config.js';
import { entityInfo, enabledEntities, entityNameSql, HttpError } from '../modules/entities.js';
import { visibleEntity, checkWriteCountry, PROTECTED_COLUMNS } from '../scope.js';
import { scanModule, embeddingStage, cosineSimilarity, type StageCounts } from '../matching.js';
import { logger } from '../logger.js';
import { parsePaging, pagedSql, pagedResult, wrap } from '../lib/paging.js';

const router = Router();


// Both records of a candidate pair must be visible to the caller (Postgres RLS on entity tables).
const pairVisible = (alias: string) =>
  `${visibleEntity(`${alias}.entity_type`, `${alias}.entity_id_a`)} AND ${visibleEntity(`${alias}.entity_type`, `${alias}.entity_id_b`)}`;

async function candidateInScope(user: string, id: string): Promise<boolean> {
  const r = await userDb(user).query(`SELECT ${pairVisible('mc')} AS ok FROM mdm.match_candidate mc WHERE mc.id = $1`, [id]);
  return !!r.rows[0]?.ok;
}

// Stewards and admins may run matching; their scope comes from RLS on the user connection.
async function requireEditorUser(user: string): Promise<boolean> {
  return (await getAppUser(user)).role !== 'VIEWER';
}

router.get('/', asyncHandler(async (req, res) => {
  const { entity_type } = req.query;
  const user = req.headers['x-mdm-user'] as string;
  // Hide pairs where either side has been merged away (any enabled module)
  const deletedChecks = enabledEntities().map(e =>
    `AND NOT EXISTS (SELECT 1 FROM ${e.table} d WHERE d.id IN (mc.entity_id_a, mc.entity_id_b) AND d.is_deleted = true)`).join('\n    ');
  const nameA = entityNameSql('mc.entity_type', 'mc.entity_id_a');
  const nameB = entityNameSql('mc.entity_type', 'mc.entity_id_b');
  let sql = `SELECT mc.*, ${nameA} AS name_a, ${nameB} AS name_b FROM mdm.match_candidate mc WHERE mc.status = $1
    ${deletedChecks}
    AND ${pairVisible('mc')}`;
  const params: unknown[] = ['PENDING'];
  if (entity_type) { params.push(String(entity_type).toUpperCase()); sql += ` AND mc.entity_type = $${params.length}`; }
  if (typeof req.query.match_method === 'string') { params.push(req.query.match_method); sql += ` AND mc.match_method = $${params.length}`; }
  const p = parsePaging(req, {
    match_score: 'mc.match_score', match_method: 'mc.match_method', entity_type: 'mc.entity_type', created_at: 'mc.created_at',
  }, 'mc.match_score DESC, mc.id');
  if (p.q) {
    params.push(`%${p.q}%`);
    const i = params.length;
    sql += ` AND (${nameA} ILIKE $${i} OR ${nameB} ILIKE $${i} OR mc.match_method ILIKE $${i} OR mc.match_score::text ILIKE $${i})`;
  }
  const result = await userDb(user).query(pagedSql(sql, p, params), params);
  const shaped = pagedResult(result.rows, p);
  if (Array.isArray(shaped)) { res.json(shaped); return; }
  // Paged: include both records of each pair on this page (so the UI need not load whole tables)
  const records: Record<string, unknown> = {};
  const byType = new Map<string, string[]>();
  for (const r of shaped.rows as { entity_type: string; entity_id_a: string; entity_id_b: string }[]) {
    const ids = byType.get(r.entity_type) ?? [];
    ids.push(r.entity_id_a, r.entity_id_b);
    byType.set(r.entity_type, ids);
  }
  for (const [type, ids] of byType) {
    const { table } = entityInfo(type, { includeDisabled: true });
    for (const row of (await userDb(user).query(`SELECT * FROM ${table} WHERE id = ANY($1)`, [ids])).rows) records[row.id] = row;
  }
  res.json({ ...shaped, records });
}));

// GET /api/matches/counts — pending candidates per entity type (tab badges)
router.get('/counts', asyncHandler(async (req, res) => {
  const deletedChecks = enabledEntities().map(e =>
    `AND NOT EXISTS (SELECT 1 FROM ${e.table} d WHERE d.id IN (mc.entity_id_a, mc.entity_id_b) AND d.is_deleted = true)`).join(' ');
  const r = await userDb(req.headers['x-mdm-user'] as string).query(
    `SELECT mc.entity_type, COUNT(*)::int AS count FROM mdm.match_candidate mc
      WHERE mc.status = 'PENDING' ${deletedChecks} AND ${pairVisible('mc')} GROUP BY 1`);
  res.json(Object.fromEntries(r.rows.map((x: { entity_type: string; count: number }) => [x.entity_type, x.count])));
}));

// POST /api/matches/scan — run the matching pipeline (config-driven, optionally filtered)
router.post('/scan', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  if (!(await requireEditorUser(user))) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  checkRateLimit(user);
  const { entity_type, methods: methodFilter } = req.body as { entity_type?: string; methods?: string[] };
  const shouldRun = (key: string) => !methodFilter || methodFilter.includes(key);
  const targetModules = getEnabledModules().filter(m => !entity_type || m.id.toUpperCase() === entity_type.toUpperCase());

  // Caller's connection: RLS limits matching to entities in the user's country scope
  const results = await withUser(user, async (client) => {
    const out: ({ type: string; timings_ms: Record<string, number>; blocking: string[] } & StageCounts)[] = [];
    for (const mod of targetModules) {
      if (!mod.matching?.enabled) continue;
      const r = await scanModule(client, mod, shouldRun, { user });
      out.push({ type: mod.id.toUpperCase(), ...r.counts, timings_ms: r.timings, blocking: r.blocking });
    }
    return out;
  });
  res.json({ status: 'complete', results });
}));

// POST /api/matches/enrich — run AI stages (embedding + LLM) on existing pending candidates
router.post('/enrich', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  if (!(await requireEditorUser(user))) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  checkRateLimit(user);
  // Caller's connection (`pool` shadowed on purpose): RLS limits matching to entities in the user's country scope
  await withUser(user, async (pool) => {
  const { methods: methodFilter } = req.body as { methods?: string[] } || {};
  const shouldRun = (key: string) => !methodFilter || methodFilter.includes(key);
  const modules = getEnabledModules();
  const results: { type: string; embedding: number; llm: number; embedded?: number; cached?: number }[] = [];

  for (const mod of modules) {
    const eType = mod.id.toUpperCase();
    const matchCfg = mod.matching;
    if (!matchCfg?.enabled) continue;
    const methods = matchCfg.methods ?? {};

    const table = `mdm.${mod.id}`;
    let embeddingCount = 0, llmCount = 0;
    let embStats: { embedded?: number; cached?: number } = {};

    // STAGE: Cortex Embedding similarity (vectors cached per record; compared within blocks)
    if (shouldRun('embedding') && methods.embedding?.enabled !== false) {
      try { const r = await embeddingStage(pool, mod, { user }); embeddingCount = r.inserted; embStats = { embedded: r.embedded, cached: r.cached }; }
      catch (e) { logger.error({ err: e, module: mod.id }, 'embedding stage failed'); }
    }

    // STAGE: LLM Judge — evaluate borderline candidates
    if (shouldRun('llm_judge') && methods.llm_judge?.enabled !== false) {
      const llmModel = methods.llm_judge?.model ?? 'mistral-large2';
      const borderline = (await pool.query(
        `SELECT mc.id, mc.entity_id_a, mc.entity_id_b, mc.match_score, mc.match_method FROM mdm.match_candidate mc
         WHERE mc.entity_type = $1 AND mc.status = 'PENDING'
           AND mc.match_method NOT LIKE '%LLM%' AND ${pairVisible('mc')}
         ORDER BY match_score DESC LIMIT 20`,
        [eType]
      )).rows;

      for (const candidate of borderline) {
        try {
          const pair = (await pool.query(`SELECT * FROM ${table} WHERE id = ANY($1) AND is_deleted = false`, [[candidate.entity_id_a, candidate.entity_id_b]])).rows;
          const eA = pair.find(e => e.id === candidate.entity_id_a);
          const eB = pair.find(e => e.id === candidate.entity_id_b);
        if (!eA || !eB) continue;

        const prompt = `You are an MDM data quality expert. Determine if these two ${eType.toLowerCase()} records represent the SAME real-world entity.

Record A: ${JSON.stringify(eA, null, 2)}
Record B: ${JSON.stringify(eB, null, 2)}

Consider:
- Name variations, abbreviations, translations, rebrandings (e.g., Facebook = Meta)
- Tax IDs, DUNS numbers, SIREN codes as strong signals
- Geographic overlap (same city/country)
- Industry/segment alignment

Respond with ONLY a JSON object:
{"same_entity": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

        const raw = (await complete({ user, endpoint: 'matches/enrich:llm_judge' }, prompt, llmModel)) || '{}';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const verdict = JSON.parse(jsonMatch[0]) as { same_entity: boolean; confidence: number; reasoning: string };
          const newScore = verdict.same_entity
            ? Math.round(verdict.confidence * 100 * 100) / 100
            : Math.round((1 - verdict.confidence) * 100 * 100) / 100;
          const originalMethod = String(candidate.match_method || 'UNKNOWN');
          const enrichedMethod = `${originalMethod}+LLM`;
          await pool.query(
            `UPDATE mdm.match_candidate SET match_score = $2, match_method = $3, match_fields = match_fields || $4 WHERE id = $1`,
            [candidate.id, newScore, enrichedMethod,
              JSON.stringify({ original_method: originalMethod, original_score: candidate.match_score, llm_confidence: verdict.confidence, llm_same_entity: verdict.same_entity, llm_reasoning: verdict.reasoning })]
          );
          llmCount++;
        }
      } catch (e) { logger.error({ err: e, candidate: candidate.id }, 'LLM judge failed'); }
    }
    } // end llm_judge

    results.push({ type: eType, embedding: embeddingCount, llm: llmCount, ...embStats });
  }

  res.json({ status: 'complete', results });
  });
}));

// POST /api/matches/:id/ai-dedup — run AI (embedding+LLM) on a single candidate
router.post('/:id/ai-dedup', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.headers['x-mdm-user'] as string;
  if (!(await candidateInScope(user, id))) return res.status(404).json({ error: 'Candidate not found' });
  checkRateLimit(user);
  const candidate = (await pool.query(
    `SELECT id, entity_type, entity_id_a, entity_id_b, match_score, match_method, match_fields FROM mdm.match_candidate WHERE id = $1`,
    [id]
  )).rows[0];
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
  if (String(candidate.match_method).includes('LLM')) return res.json({ status: 'already_enriched', candidate });

  const eType = candidate.entity_type;
  const { table, mod } = entityInfo(eType);
  const matchCfg = mod?.matching;
  const methods = matchCfg?.methods ?? {};

  const eA = (await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [candidate.entity_id_a])).rows[0];
  const eB = (await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [candidate.entity_id_b])).rows[0];
  if (!eA || !eB) return res.status(404).json({ error: 'Entity not found' });

  // Try embedding similarity first — read config
  let embeddingSim: number | null = null;
  const embModel = methods.embedding?.model ?? 'e5-base-v2';
  const descFields = methods.embedding?.description_fields ?? [mod?.name_field ?? 'legal_name'];
  try {
    const descA = descFields.map((f: string) => String(eA[f] || '')).filter(Boolean).join(' ');
    const descB = descFields.map((f: string) => String(eB[f] || '')).filter(Boolean).join(' ');
    const [vA, vB] = await embed({ user, endpoint: 'matches/ai-dedup:embedding' }, [descA || ' ', descB || ' '], embModel);
    if (vA?.length && vB?.length) embeddingSim = cosineSimilarity(vA, vB);
  } catch (e) { logger.error({ err: e, candidate: id }, 'embedding failed for candidate'); }

  // LLM Judge — read model from config
  const llmModel = methods.llm_judge?.model ?? 'mistral-large2';
  const prompt = `You are an MDM data quality expert. Determine if these two ${eType.toLowerCase()} records represent the SAME real-world entity.

Record A: ${JSON.stringify(eA, null, 2)}
Record B: ${JSON.stringify(eB, null, 2)}

Consider:
- Name variations, abbreviations, translations, rebrandings (e.g., Facebook = Meta)
- Tax IDs, DUNS numbers, SIREN codes as strong signals
- Geographic overlap (same city/country)
- Industry/segment alignment

Respond with ONLY a JSON object:
{"same_entity": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  const raw = (await complete({ user, endpoint: 'matches/ai-dedup:llm_judge' }, prompt, llmModel)) || '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return res.status(500).json({ error: 'LLM returned no parseable result' });

  const verdict = JSON.parse(jsonMatch[0]) as { same_entity: boolean; confidence: number; reasoning: string };
  const newScore = verdict.same_entity
            ? Math.round(verdict.confidence * 100 * 100) / 100
            : Math.round((1 - verdict.confidence) * 100 * 100) / 100;
  const originalMethod = String(candidate.match_method || 'UNKNOWN');
  const enrichedMethod = `${originalMethod}+LLM`;
  const extraFields: Record<string, unknown> = {
    original_method: originalMethod,
    original_score: candidate.match_score,
    llm_confidence: verdict.confidence,
    llm_same_entity: verdict.same_entity,
    llm_reasoning: verdict.reasoning,
  };
  if (embeddingSim != null) extraFields.embedding_similarity = Math.round(embeddingSim * 100) / 100;

  await pool.query(
    `UPDATE mdm.match_candidate SET match_score = $2, match_method = $3, match_fields = match_fields || $4 WHERE id = $1`,
    [candidate.id, newScore, enrichedMethod, JSON.stringify(extraFields)]
  );

  const updated = (await pool.query(`SELECT * FROM mdm.match_candidate WHERE id = $1`, [id])).rows[0];
  res.json({ status: 'enriched', candidate: updated });
}));

// Never taken from the loser: identity, provenance, placement, lifecycle, scores and audit columns.
const NEVER_COPY = new Set(['id', 'golden_id', 'source_system', 'source_id', 'country_code', 'parent_id', 'lifecycle_stage',
  'dq_score', 'completeness', 'last_dq_check', 'created_by', 'created_at', 'updated_by', 'updated_at', 'is_deleted',
  'hierarchy_path', 'hierarchy_level', 'dnb_enriched', 'dnb_enriched_at', 'extended_attrs']);

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

interface Repointed {
  children: string[];
  workflows: number[];
  comments: { id: number; comment_text: string }[];
  dq_results_deleted: number;
  survivor_fields: string[];
  survivor_updated_at: string;
}

router.put('/:id', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  if (!(await requireEditorUser(user))) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const { status, survivor_id, field_overrides } = req.body as {
    status: string;
    survivor_id?: string;
    field_overrides?: Record<string, 'A' | 'B'>;
  };

  const matchResult = await pool.query('SELECT * FROM mdm.match_candidate WHERE id = $1', [req.params.id]);
  if (matchResult.rows.length === 0 || !(await candidateInScope(user, req.params.id))) { res.status(404).json({ error: 'Not found' }); return; }
  const match = matchResult.rows[0];

  if (status === 'REJECTED') {
    const result = await pool.query(
      'UPDATE mdm.match_candidate SET status = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id, 'REJECTED', user]
    );
    res.json(result.rows[0]);
    return;
  }
  if (status !== 'MERGED' && status !== 'CONFIRMED') { res.status(400).json({ error: 'status must be MERGED (or CONFIRMED) or REJECTED' }); return; }
  if (match.status !== 'PENDING') { res.status(409).json({ error: `Candidate is already ${match.status}` }); return; }

  const ent = entityInfo(match.entity_type);
  const { type: entityType, table, nameCol } = ent;
  if (survivor_id && survivor_id !== match.entity_id_a && survivor_id !== match.entity_id_b) {
    res.status(400).json({ error: 'survivor_id must be one of the candidate records' }); return;
  }
  const mergeable = ent.mod.fields
    .filter(f => f.active !== false && !NEVER_COPY.has(f.name) && !PROTECTED_COLUMNS.has(f.name) && f.name !== ent.parentField)
    .map(f => assertIdent(f.name, 'field'));

  // Merge in one transaction on the caller's connection (RLS applies).
  const out = await withUser(user, async (client, appUser) => {
    await client.query('BEGIN');
    try {
      const rows = (await client.query(`SELECT * FROM ${table} WHERE id = ANY($1) AND is_deleted = false FOR UPDATE`,
        [[match.entity_id_a, match.entity_id_b]])).rows;
      const a = rows.find(r => r.id === match.entity_id_a);
      const b = rows.find(r => r.id === match.entity_id_b);
      if (!a || !b) throw new HttpError(400, 'One or both entities no longer exist');

      // Survivor: user choice > DQ score > record A
      const survivor = survivor_id ? (survivor_id === a.id ? a : b)
        : ((parseFloat(a.dq_score) || 0) >= (parseFloat(b.dq_score) || 0) ? a : b);
      const loser = survivor.id === a.id ? b : a;
      const survivorIsA = survivor.id === a.id;

      const survivorship: Record<string, { source: string; value: unknown }> = {};
      const sets: string[] = [];
      const params: unknown[] = [survivor.id];
      const take = (key: string, value: unknown, source: string) => {
        params.push(value); sets.push(`${key} = $${params.length}`);
        survivorship[key] = { source, value };
      };
      for (const key of mergeable) {
        const sVal = survivor[key], lVal = loser[key];
        const override = field_overrides?.[key];
        const useLoser = override ? (survivorIsA ? override === 'B' : override === 'A') : false;
        if (useLoser && !isEmpty(lVal)) take(key, lVal, 'override');
        else if (isEmpty(sVal) && !isEmpty(lVal)) take(key, lVal, 'fill');
        else if (!isEmpty(sVal)) survivorship[key] = { source: 'survivor', value: sVal };
      }
      // Country only by explicit override, and only into a country the caller may write
      const cOverride = field_overrides?.country_code;
      if (ent.hasCountry && cOverride && (survivorIsA ? cOverride === 'B' : cOverride === 'A')
          && !isEmpty(loser.country_code) && loser.country_code !== survivor.country_code) {
        const denied = checkWriteCountry(appUser, ent.moduleId, loser.country_code);
        if (denied) throw new HttpError(denied.status, denied.error);
        take('country_code', loser.country_code, 'override');
      }
      const enriched = sets.length;

      const goldenId = survivor.golden_id
        || (await client.query('SELECT mdm.next_golden_id($1) AS g', [ent.goldenPrefix])).rows[0].g;
      params.push(goldenId); sets.push(`golden_id = $${params.length}`);
      params.push(JSON.stringify({ ...(loser.extended_attrs || {}), ...(survivor.extended_attrs || {}) })); sets.push(`extended_attrs = $${params.length}`);
      params.push(user); sets.push(`updated_by = $${params.length}`);
      await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, params);

      // The loser stays as a deleted cross-reference under the survivor's golden ID
      await client.query(`UPDATE ${table} SET is_deleted = true, golden_id = $2, updated_by = $3 WHERE id = $1`, [loser.id, goldenId, user]);

      // Re-point what referenced the loser (only rows visible to the caller move)
      const children: string[] = ent.parentField
        ? (await client.query(`UPDATE ${table} SET ${ent.parentField} = $2, updated_by = $3 WHERE ${ent.parentField} = $1 AND id <> $2 RETURNING id`,
            [loser.id, survivor.id, user])).rows.map(r => r.id) : [];
      const workflows: number[] = (await client.query(
        `UPDATE mdm.workflow_instance SET entity_id = $2, updated_at = NOW() WHERE entity_type = $3 AND entity_id = $1 AND completed_at IS NULL RETURNING id`,
        [loser.id, survivor.id, entityType])).rows.map(r => r.id);
      const comments: { id: number; comment_text: string }[] = (await client.query(
        `UPDATE mdm.entity_comment c SET entity_id = $2, comment_text = $4 || c.comment_text
           FROM mdm.entity_comment o WHERE o.id = c.id AND c.entity_type = $3 AND c.entity_id = $1
         RETURNING c.id, o.comment_text`,
        [loser.id, survivor.id, entityType, `[merged from ${loser[nameCol]}] `])).rows;
      const dq = await client.query('DELETE FROM mdm.dq_result WHERE entity_type = $1 AND entity_id = $2', [entityType, loser.id]);
      const after = (await client.query(`SELECT updated_at FROM ${table} WHERE id = $1`, [survivor.id])).rows[0];

      const repointed: Repointed = {
        children, workflows, comments, dq_results_deleted: dq.rowCount ?? 0,
        survivor_fields: Object.entries(survivorship).filter(([, v]) => v.source !== 'survivor').map(([k]) => k).concat('extended_attrs', 'golden_id'),
        survivor_updated_at: after.updated_at,
      };
      const mh = await client.query(
        `INSERT INTO mdm.merge_history (entity_type, survivor_id, merged_id, survivorship, merged_by, survivor_snapshot, loser_snapshot, repointed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [entityType, survivor.id, loser.id, JSON.stringify(survivorship), user, JSON.stringify(survivor), JSON.stringify(loser), JSON.stringify(repointed)]);

      await client.query(
        'UPDATE mdm.match_candidate SET status = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $1',
        [req.params.id, 'MERGED', user]);
      // Other pending candidates on the merged (deleted) record are moot
      await client.query(
        `UPDATE mdm.match_candidate SET status = 'AUTO_REJECTED', reviewed_by = $2, reviewed_at = NOW()
         WHERE status = 'PENDING' AND (entity_id_a = $1 OR entity_id_b = $1)`,
        [loser.id, user]);

      await client.query('COMMIT');
      return { survivor, loser, goldenId, mergeId: mh.rows[0].id as number, repointed, enriched };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });

  res.json({
    status: 'MERGED',
    merge_id: out.mergeId,
    survivor_id: out.survivor.id,
    survivor_name: out.survivor[nameCol],
    loser_id: out.loser.id,
    loser_name: out.loser[nameCol],
    golden_id: out.goldenId,
    fields_enriched: out.enriched,
    repointed: { children: out.repointed.children.length, workflows: out.repointed.workflows.length, comments: out.repointed.comments.length },
  });
}));

// GET /api/matches/merges — merge history for enabled modules (both records visible to the caller)
router.get('/merges', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const blocks = enabledEntities().map(e => `
    SELECT mh.id, mh.entity_type, mh.survivor_id, mh.merged_id, mh.merged_by, mh.merged_at, mh.unmerged_at, mh.unmerged_by,
           (mh.loser_snapshot IS NOT NULL) AS can_unmerge,
           s.${e.nameCol}::text AS survivor_name, m.${e.nameCol}::text AS merged_name, s.golden_id
      FROM mdm.merge_history mh
      JOIN ${e.table} s ON s.id = mh.survivor_id
      JOIN ${e.table} m ON m.id = mh.merged_id
     WHERE mh.entity_type = '${e.type}'`);
  if (!blocks.length) { res.json([]); return; }
  const p = parsePaging(req, { merged_at: 'merged_at', merged_by: 'merged_by', entity_type: 'entity_type', survivor_name: 'survivor_name' }, 'merged_at DESC, id DESC');
  const params: unknown[] = [];
  let sql = wrap(blocks.join(' UNION ALL '));
  if (p.q) { params.push(`%${p.q}%`); sql += ` WHERE survivor_name ILIKE $1 OR merged_name ILIKE $1 OR merged_by ILIKE $1`; }
  // Unpaged callers keep the historical 200-row cap
  sql = p.paged ? pagedSql(sql, p, params) : `${sql} ORDER BY ${p.orderBy} LIMIT 200`;
  const r = await userDb(user).query(sql, params);
  res.json(pagedResult(r.rows, p));
}));

// POST /api/matches/merges/:id/unmerge  { force?: boolean } — restore both records and move re-pointed rows back
router.post('/merges/:id/unmerge', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  if (!(await requireEditorUser(user))) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const mhId = parseInt(req.params.id, 10);
  if (isNaN(mhId)) { res.status(400).json({ error: 'Invalid merge id' }); return; }

  const result = await withUser(user, async (client, appUser) => {
    await client.query('BEGIN');
    try {
      const mh = (await client.query('SELECT * FROM mdm.merge_history WHERE id = $1 FOR UPDATE', [mhId])).rows[0];
      if (!mh) throw new HttpError(404, 'Merge not found');
      if (mh.unmerged_at) throw new HttpError(409, 'Merge already undone');
      if (!mh.loser_snapshot || !mh.repointed) throw new HttpError(409, 'This merge predates unmerge support');
      const ent = entityInfo(mh.entity_type, { includeDisabled: true });
      const { table } = ent;
      const rp = mh.repointed as Repointed;

      // RLS: both records must be visible to the caller
      const rows = (await client.query(`SELECT id, updated_at FROM ${table} WHERE id = ANY($1) FOR UPDATE`, [[mh.survivor_id, mh.merged_id]])).rows;
      const survivor = rows.find(r => r.id === mh.survivor_id);
      if (!survivor || !rows.find(r => r.id === mh.merged_id)) throw new HttpError(404, 'Merge not found');
      if (new Date(survivor.updated_at).getTime() > new Date(rp.survivor_updated_at).getTime()
          && !(req.body?.force === true && appUser.role === 'ADMIN')) {
        throw new HttpError(409, 'The surviving record changed after the merge; an administrator can force the unmerge');
      }

      // Survivor: restore the columns the merge wrote
      const params: unknown[] = [mh.survivor_id, user];
      const sets = rp.survivor_fields.map(c => {
        assertIdent(c, 'field');
        const v = mh.survivor_snapshot[c];
        params.push(c === 'extended_attrs' ? JSON.stringify(v ?? {}) : v ?? null);
        return `${c} = $${params.length}`;
      });
      await client.query(`UPDATE ${table} SET ${sets.concat('updated_by = $2').join(', ')} WHERE id = $1`, params);
      // Loser: back to life with its own golden ID
      await client.query(`UPDATE ${table} SET is_deleted = false, golden_id = $2, updated_by = $3 WHERE id = $1`,
        [mh.merged_id, mh.loser_snapshot.golden_id ?? null, user]);

      // Move re-pointed rows back (only those still pointing at the survivor)
      let children = 0;
      if (ent.parentField && rp.children.length) {
        children = (await client.query(`UPDATE ${table} SET ${ent.parentField} = $1, updated_by = $4 WHERE id = ANY($3) AND ${ent.parentField} = $2`,
          [mh.merged_id, mh.survivor_id, rp.children, user])).rowCount ?? 0;
      }
      const workflows = rp.workflows.length ? (await client.query(
        'UPDATE mdm.workflow_instance SET entity_id = $1, updated_at = NOW() WHERE id = ANY($3) AND entity_id = $2',
        [mh.merged_id, mh.survivor_id, rp.workflows])).rowCount ?? 0 : 0;
      let comments = 0;
      for (const c of rp.comments) {
        comments += (await client.query('UPDATE mdm.entity_comment SET entity_id = $1, comment_text = $3 WHERE id = $2 AND entity_id = $4',
          [mh.merged_id, c.id, c.comment_text, mh.survivor_id])).rowCount ?? 0;
      }

      await client.query('UPDATE mdm.merge_history SET unmerged_at = NOW(), unmerged_by = $2 WHERE id = $1', [mhId, user]);
      // The pair can be reviewed again
      await client.query(
        `UPDATE mdm.match_candidate SET status = 'PENDING', reviewed_by = $3, reviewed_at = NOW()
          WHERE entity_type = $4 AND status = 'MERGED'
            AND ((entity_id_a = $1 AND entity_id_b = $2) OR (entity_id_a = $2 AND entity_id_b = $1))`,
        [mh.survivor_id, mh.merged_id, user, mh.entity_type]);
      await client.query('COMMIT');
      return { survivor_id: mh.survivor_id, restored_id: mh.merged_id, moved_back: { children, workflows, comments },
               dq_results_to_recompute: rp.dq_results_deleted };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });
  res.json({ status: 'UNMERGED', ...result });
}));

// --- Utility functions ---


export default router;
