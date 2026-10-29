// PII masking in the API, aligned with Snowflake.
//
// One rule for both surfaces: a user sees PII in clear in the UI exactly when their Snowflake
// role (app_user.sf_role, the role Cortex Analyst runs as) sees it in clear in Snowflake — i.e.
// the role, or a role it inherits, is in governance.pii_unmask_roles (synced to
// GOVERNANCE.PII_UNMASK_ROLES, which the PII_STRING_MASK policy reads).
//
// Which fields are PII is configured per entity (governance.pii_fields) and applied both here and
// as PII_TYPE tags on the Snowflake views. Masking is server-side: JSON responses are rewritten
// before they leave the API, and PII fields are dropped from writes by masked users so a masked
// value can never be saved over the real one.
import type { Request, Response, NextFunction } from 'express';
import { loadConfig } from './config.js';
import { getAppUser } from './db.js';
import { sfQuery, snowflakeConfigured } from './snowflake.js';
import { logger } from './logger.js';

export const DEFAULT_UNMASK_ROLES = ['MDM_ADMIN_ROLE'];
export const DEFAULT_PII_FIELDS: Record<string, string[]> = {
  customer: ['tax_id', 'email', 'phone'],
  supplier: ['tax_id', 'vat_number', 'bank_account_iban', 'email', 'primary_contact_email', 'phone'],
};
// Roles that always see clear values in Snowflake (see 004_governance.sql)
const ALWAYS_CLEAR = new Set(['ACCOUNTADMIN', 'MDM_SERVICE_ROLE']);

export function unmaskRoles(): string[] {
  return loadConfig().governance?.pii_unmask_roles ?? DEFAULT_UNMASK_ROLES;
}

export function piiFields(): Record<string, string[]> {
  return loadConfig().governance?.pii_fields ?? DEFAULT_PII_FIELDS;
}

/** Union of PII field names across entities — responses mix entities (search, audit, matches). */
function allPiiFields(): Set<string> {
  return new Set(Object.values(piiFields()).flat());
}

// ── Role hierarchy (SHOW GRANTS TO ROLE), cached ──
const ROLE_TTL = 10 * 60_000;
const inheritedCache = new Map<string, { at: number; roles: Set<string> }>();

async function inheritedRoles(role: string): Promise<Set<string>> {
  const hit = inheritedCache.get(role);
  if (hit && Date.now() - hit.at < ROLE_TTL) return hit.roles;
  const seen = new Set<string>([role]);
  const queue = [role];
  while (queue.length) {
    const r = queue.shift()!;
    if (!/^[A-Z_][A-Z0-9_$]{0,254}$/.test(r)) continue;
    const grants = await sfQuery(`SHOW GRANTS TO ROLE ${r}`);
    for (const g of grants) {
      if (g.granted_on === 'ROLE' && g.privilege === 'USAGE') {
        const child = String(g.name).toUpperCase();
        if (!seen.has(child)) { seen.add(child); queue.push(child); }
      }
    }
  }
  inheritedCache.set(role, { at: Date.now(), roles: seen });
  return seen;
}

/** Call after the unmask list changes or role grants are edited. */
export function resetPiiCache() { inheritedCache.clear(); }

/**
 * Whether this user sees PII in clear. Fails closed: no Snowflake role, or the hierarchy cannot
 * be read, means masked. Without Snowflake configured, falls back to the direct role only.
 */
export async function canSeePii(email: string): Promise<boolean> {
  if (!email) return false;
  const user = await getAppUser(email);
  const role = (user.sf_role || loadConfig().users.find(u => u.email === email)?.sf_role || '').toUpperCase();
  if (!role) return false;
  if (ALWAYS_CLEAR.has(role)) return true;
  const allowed = new Set(unmaskRoles().map(r => r.toUpperCase()));
  if (allowed.has(role)) return true;
  if (!snowflakeConfigured()) return false;
  try {
    for (const r of await inheritedRoles(role)) if (allowed.has(r) || ALWAYS_CLEAR.has(r)) return true;
  } catch (err) {
    logger.warn({ err, role }, 'role hierarchy lookup failed; masking PII');
  }
  return false;
}

/** Same rendering as GOVERNANCE.PII_STRING_MASK: emails keep the domain, others the last 4 chars. */
export function maskValue(field: string, v: unknown): unknown {
  if (v === null || v === undefined || v === '') return v;
  const s = String(v);
  if (/email/i.test(field)) return s.includes('@') ? '***' + s.slice(s.indexOf('@')) : '***';
  return s.length > 4 ? '*'.repeat(s.length - 4) + s.slice(-4) : '****';
}

function maskDeep(node: unknown, fields: Set<string>, depth = 0): unknown {
  if (depth > 12 || node === null || typeof node !== 'object') return node;
  // Dates (pg timestamps), Buffers etc. are values, not containers: keep them as is
  if (node instanceof Date || Buffer.isBuffer(node)) return node;
  if (Array.isArray(node)) return node.map(n => maskDeep(n, fields, depth + 1));
  const obj = node as Record<string, unknown>;
  // Audit / change entries: { field: 'email', old_value, new_value }
  const named = typeof obj.field === 'string' ? obj.field : typeof obj.field_name === 'string' ? obj.field_name : null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (fields.has(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = maskValue(k, v);
    else if (named && fields.has(named) && /^(old|new|value|old_value|new_value|before|after|source_value|golden_value)$/.test(k)
             && (typeof v === 'string' || typeof v === 'number')) out[k] = maskValue(named, v);
    else out[k] = maskDeep(v, fields, depth + 1);
  }
  return out;
}

export function maskPayload(body: unknown): unknown {
  return maskDeep(body, allPiiFields());
}

// Admin/auth return user accounts (emails are identities, not record PII); config is metadata.
const SKIP = ['/api/admin', '/api/auth', '/api/config', '/api/health', '/api/ready'];

/** Express middleware: masks PII in JSON responses and strips PII from writes for masked users. */
export async function piiGuard(req: Request, res: Response, next: NextFunction) {
  if (SKIP.some(p => req.originalUrl.startsWith(p))) return next();
  let clear = false;
  try { clear = await canSeePii(req.headers['x-mdm-user'] as string); } catch { clear = false; }
  if (clear) return next();

  // Writes: a masked user cannot change PII (they only ever saw masked values)
  if (req.method !== 'GET' && req.body && typeof req.body === 'object') {
    const fields = allPiiFields();
    const strip = (o: Record<string, unknown>) => { for (const f of fields) delete o[f]; };
    strip(req.body);
    for (const k of ['changes', 'fields', 'data', 'record', 'values']) {
      const v = (req.body as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) strip(v as Record<string, unknown>);
    }
  }
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(maskPayload(body));
  res.setHeader('x-mdm-pii', 'masked');
  next();
}
