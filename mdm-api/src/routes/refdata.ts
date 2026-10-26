import { Router } from 'express';
import pool from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { requireAdmin } from '../middleware/requireRole.js';

// Reference data is global: reads for everyone, writes for administrators only.

const router = Router();

/* ── Helper: domain metadata for the built-in ref_ tables ── */
const BUILTIN_DOMAINS: Record<string, { table: string; columns: { code: string; label: string; extras: string[] }; description: string }> = {
  COUNTRY:  { table: 'mdm.ref_country',  columns: { code: 'code', label: 'name', extras: ['region'] },  description: 'ISO 3166-1 country codes' },
  CURRENCY: { table: 'mdm.ref_currency', columns: { code: 'code', label: 'name', extras: ['symbol'] },  description: 'ISO 4217 currency codes' },
  LANGUAGE: { table: 'mdm.ref_language', columns: { code: 'code', label: 'name', extras: [] },           description: 'Language codes' },
};
/** Domains listed besides codelists: the built-in tables plus LIFECYCLE_STAGE (used by Health). */
export const NON_CODELIST_DOMAIN_COUNT = Object.keys(BUILTIN_DOMAINS).length + 1;

/* ── GET /api/refdata — list all domains with value counts ── */
router.get('/', asyncHandler(async (_req, res) => {
  // Codelist domains
  const clRes = await pool.query(`
    SELECT domain, COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active
    FROM mdm.ref_codelist GROUP BY domain ORDER BY domain
  `);
  const domains: any[] = clRes.rows.map((r: any) => ({
    domain: r.domain, type: 'codelist', total: Number(r.total), active: Number(r.active), editable: true,
  }));

  // Built-in domains
  for (const [key, meta] of Object.entries(BUILTIN_DOMAINS)) {
    const r = await pool.query(`SELECT COUNT(*) AS cnt FROM ${meta.table}`);
    domains.push({ domain: key, type: 'builtin', total: Number(r.rows[0].cnt), active: Number(r.rows[0].cnt), description: meta.description, editable: true });
  }

  // Lifecycle stages (read-only display)
  const lcRes = await pool.query(`SELECT COUNT(*) AS cnt FROM mdm.ref_lifecycle_stage`);
  domains.push({ domain: 'LIFECYCLE_STAGE', type: 'system', total: Number(lcRes.rows[0].cnt), active: Number(lcRes.rows[0].cnt), description: 'Entity lifecycle stages', editable: false });

  domains.sort((a: any, b: any) => a.domain.localeCompare(b.domain));
  res.json(domains);
}));

/* ── GET /api/refdata/:domain — get all values for a domain ── */
router.get('/:domain', asyncHandler(async (req, res) => {
  const domain = req.params.domain.toUpperCase();

  // Built-in table?
  const builtin = BUILTIN_DOMAINS[domain];
  if (builtin) {
    const extras = builtin.columns.extras.length ? `, ${builtin.columns.extras.join(', ')}` : '';
    const r = await pool.query(`SELECT ${builtin.columns.code} AS code, ${builtin.columns.label} AS label${extras} FROM ${builtin.table} ORDER BY ${builtin.columns.label}`);
    return res.json({ domain, type: 'builtin', values: r.rows });
  }

  // Lifecycle (read-only)
  if (domain === 'LIFECYCLE_STAGE') {
    const r = await pool.query(`SELECT entity_type, stage_code AS code, stage_label AS label, sort_order, is_terminal FROM mdm.ref_lifecycle_stage ORDER BY entity_type, sort_order`);
    return res.json({ domain, type: 'system', values: r.rows });
  }

  // Codelist
  const r = await pool.query(
    `SELECT id, code, label, description, metadata, sort_order, is_active, created_at, updated_at
     FROM mdm.ref_codelist WHERE domain = $1 ORDER BY sort_order, code`, [domain]);
  res.json({ domain, type: 'codelist', values: r.rows });
}));

/* ── POST /api/refdata/:domain — add a value ── */
router.post('/:domain', requireAdmin, asyncHandler(async (req, res, next) => {
  const domain = req.params.domain.toUpperCase();
  const { code, label, description, metadata, sort_order } = req.body;
  if (!code || !label) return res.status(400).json({ error: 'code and label are required' });

  try {
    const builtin = BUILTIN_DOMAINS[domain];
    if (builtin) {
      const cols = [builtin.columns.code, builtin.columns.label, ...builtin.columns.extras.filter(e => req.body[e] !== undefined)];
      const vals = [code, label, ...builtin.columns.extras.filter(e => req.body[e] !== undefined).map(e => req.body[e])];
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      await pool.query(`INSERT INTO ${builtin.table} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
      return res.status(201).json({ code, label });
    }

    if (domain === 'LIFECYCLE_STAGE') return res.status(403).json({ error: 'Lifecycle stages are system-managed' });

    const r = await pool.query(
      `INSERT INTO mdm.ref_codelist (domain, code, label, description, metadata, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [domain, code, label, description || null, metadata || '{}', sort_order || 0]);
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
}));

/* ── PUT /api/refdata/:domain/:code — update a value ── */
router.put('/:domain/:code', requireAdmin, asyncHandler(async (req, res, next) => {
  const domain = req.params.domain.toUpperCase();
  const code = req.params.code;
  const { label, description, metadata, sort_order, is_active } = req.body;

  try {
    const builtin = BUILTIN_DOMAINS[domain];
    if (builtin) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      if (label !== undefined)  { sets.push(`${builtin.columns.label} = $${idx++}`); vals.push(label); }
      for (const extra of builtin.columns.extras) {
        if (req.body[extra] !== undefined) { sets.push(`${extra} = $${idx++}`); vals.push(req.body[extra]); }
      }
      if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
      vals.push(code);
      await pool.query(`UPDATE ${builtin.table} SET ${sets.join(', ')} WHERE ${builtin.columns.code} = $${idx}`, vals);
      return res.json({ code, updated: true });
    }

    if (domain === 'LIFECYCLE_STAGE') return res.status(403).json({ error: 'Lifecycle stages are system-managed' });

    const sets: string[] = ['updated_at = NOW()'];
    const vals: any[] = [];
    let idx = 1;
    if (label !== undefined)       { sets.push(`label = $${idx++}`);       vals.push(label); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (metadata !== undefined)    { sets.push(`metadata = $${idx++}`);    vals.push(metadata); }
    if (sort_order !== undefined)  { sets.push(`sort_order = $${idx++}`);  vals.push(sort_order); }
    if (is_active !== undefined)   { sets.push(`is_active = $${idx++}`);   vals.push(is_active); }
    vals.push(domain, code);
    const r = await pool.query(
      `UPDATE mdm.ref_codelist SET ${sets.join(', ')} WHERE domain = $${idx++} AND code = $${idx} RETURNING *`, vals);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
}));

/* ── DELETE /api/refdata/:domain/:code — remove a value ── */
router.delete('/:domain/:code', requireAdmin, asyncHandler(async (req, res, next) => {
  const domain = req.params.domain.toUpperCase();
  const code = req.params.code;

  try {
    const builtin = BUILTIN_DOMAINS[domain];
    if (builtin) {
      const r = await pool.query(`DELETE FROM ${builtin.table} WHERE ${builtin.columns.code} = $1`, [code]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
      return res.json({ deleted: true });
    }

    if (domain === 'LIFECYCLE_STAGE') return res.status(403).json({ error: 'Lifecycle stages are system-managed' });

    const r = await pool.query(`DELETE FROM mdm.ref_codelist WHERE domain = $1 AND code = $2`, [domain, code]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}));

/* ── POST /api/refdata — create a new domain (empty) ── */
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  const normalized = domain.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (BUILTIN_DOMAINS[normalized] || normalized === 'LIFECYCLE_STAGE') {
    return res.status(409).json({ error: 'This domain name is reserved' });
  }
  res.status(201).json({ domain: normalized, type: 'codelist', total: 0, active: 0, editable: true });
}));

export default router;
