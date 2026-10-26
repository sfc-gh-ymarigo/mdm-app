// ============================================================
// Generic Entity Router — config-driven CRUD for any MDM module
// ============================================================
import { Router } from 'express';
import pool, { getAppUser, withUser } from '../db.js';
import { getModule } from '../config.js';
import { HttpError } from './entities.js';
import { asyncHandler } from '../asyncHandler.js';
import { assertIdent } from '../sqlGuard.js';
import { parsePaging, pagedSql, pagedResult } from '../lib/paging.js';
import { scopeClause, checkWriteCountry, countryChanged, PROTECTED_COLUMNS, reportIgnored } from '../scope.js';

export function createEntityRouter(moduleId: string): Router {
  const router = Router();
  const sysCols = 'id,source_system,source_id,lifecycle_stage,golden_id,dq_score,completeness,is_deleted,created_by,updated_by,created_at,updated_at,extended_attrs';

  // JSON columns writable besides the configured fields (extended attributes, product translations)
  let jsonCols: Promise<string[]> | null = null;
  const writableJsonCols = (tbl: string) => (jsonCols ??= pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema || '.' || table_name = $1 AND column_name IN ('extended_attrs', 'translations')`, [tbl])
    .then(r => r.rows.map(x => x.column_name as string)));

  // Module config is read per request, so field toggles and joins apply without a restart.
  // Only the route wiring is cached (server.ts).
  function current() {
    const mod = getModule(moduleId);
    if (!mod?.enabled) throw new HttpError(404, `Module "${moduleId}" not found or disabled`);
    const activeFieldNames = mod.fields.filter(f => f.active !== false).map(f => f.name);
    const hasCountry = activeFieldNames.includes('country_code');
    const scopeCond = (appUser: Parameters<typeof scopeClause>[0], col: string, params: unknown[]) =>
      hasCountry ? scopeClause(appUser, mod.id, col, params) : '';
    let selectCols = sysCols.split(',').concat(activeFieldNames.filter(c => !sysCols.split(',').includes(c))).map(c => `t.${c}`).join(', ');
    let joinSql = '';
    for (const j of mod.joins || []) {
      joinSql += ` ${j.type || 'LEFT'} JOIN ${j.table} ${j.alias} ON ${j.on.replace('{table}', 't')}`;
      for (const [alias, expr] of Object.entries(j.columns)) selectCols += `, ${expr} AS ${alias}`;
    }
    return { mod, tbl: mod.table, entityType: mod.id.toUpperCase(), activeFieldNames, hasCountry, scopeCond, selectCols, joinSql };
  }

  // ── LIST ────────────────────────────────────────────────
  router.get('/', asyncHandler(async (req, res) => {
    const email = req.headers['x-mdm-user'] as string;
    const appUser = await getAppUser(email);
    const { mod, tbl, scopeCond, selectCols, joinSql, activeFieldNames } = current();

    const conditions: string[] = [`t.is_deleted = false`];
    const params: unknown[] = [];

    // Country scope (Postgres RLS enforces the same rule)
    const scope = scopeCond(appUser, 't.country_code', params);
    if (scope) conditions.push(scope);
    let pi = params.length + 1;

    // Dynamic filters from config
    for (const filter of mod.filters) {
      const val = req.query[filter.field];
      if (val && typeof val === 'string') {
        conditions.push(`t.${filter.field}::text = $${pi++}`);
        params.push(val);
      }
    }
    // DQ score range
    for (const [k, op] of [['dq_min', '>='], ['dq_max', '<=']] as const) {
      const v = Number(req.query[k]);
      if (req.query[k] !== undefined && Number.isFinite(v)) { conditions.push(`COALESCE(t.dq_score, 0) ${op} $${pi++}`); params.push(v); }
    }

    const allowed: Record<string, string> = {};
    for (const c of [...sysCols.split(','), ...activeFieldNames]) if (c !== 'extended_attrs') allowed[c] = `t.${c}`;
    for (const j of mod.joins || []) for (const [alias, expr] of Object.entries(j.columns)) allowed[alias] = expr;
    const p = parsePaging(req, allowed, 't.updated_at DESC, t.id');

    // Search (ILIKE over configured search fields; ?q and ?search are equivalent)
    if (p.q) {
      const searchOr = mod.search.fields.map(f => `t.${f}::text ILIKE $${pi}`).join(' OR ');
      if (searchOr) { conditions.push(`(${searchOr})`); params.push(`%${p.q}%`); pi++; }
    }

    const sql = pagedSql(`SELECT ${selectCols} FROM ${tbl} t${joinSql} WHERE ${conditions.join(' AND ')}`, p, params);
    const result = await withUser(email, client => client.query(sql, params));
    res.json(pagedResult(result.rows, p));
  }));

  // ── FACETS (value counts for summary and filter pickers) ──
  router.get('/facets', asyncHandler(async (req, res) => {
    const email = req.headers['x-mdm-user'] as string;
    const appUser = await getAppUser(email);
    const { mod, tbl, scopeCond, activeFieldNames } = current();
    const params: unknown[] = [];
    const scope = scopeCond(appUser, 'country_code', params);
    const fields = [...new Set(['lifecycle_stage', 'source_system', ...mod.filters.map(f => f.field)])]
      .filter(f => f === 'lifecycle_stage' || f === 'source_system' || activeFieldNames.includes(f));
    const sql = `SELECT ${fields.map(f => `(SELECT COALESCE(jsonb_agg(jsonb_build_object('value', v, 'count', n) ORDER BY n DESC), '[]'::jsonb)
        FROM (SELECT ${f}::text AS v, COUNT(*)::int AS n FROM base WHERE ${f} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 200) x) AS ${f}`).join(', ')},
      (SELECT COUNT(*)::int FROM base) AS __total
      FROM (SELECT 1) one`;
    const full = `WITH base AS (SELECT * FROM ${tbl} WHERE is_deleted = false${scope ? ` AND ${scope}` : ''}) ${sql}`;
    const r = await withUser(email, client => client.query(full, params));
    const { __total, ...facets } = r.rows[0];
    res.json({ total: __total, facets });
  }));

  // ── FUZZY SEARCH ────────────────────────────────────────
  router.get('/search', asyncHandler(async (req, res) => {
      const email = req.headers['x-mdm-user'] as string;
      const { mod, tbl, scopeCond } = current();
      if (!mod.search.fuzzy) { res.status(404).json({ error: 'Fuzzy search is not configured for this module' }); return; }
      return withUser(email, async (client, appUser) => {
        const q = req.query.q as string;
        if (!q) { res.json([]); return; }

        const fuzzyFields = mod.search.fuzzy!.fields;
        const orClauses = fuzzyFields.map(f => `${f} % $1`).join(' OR ');
        const simExpr = `GREATEST(${fuzzyFields.map(f => `similarity(${f}, $1)`).join(', ')})`;

        const conditions = [`is_deleted = false`, `(${orClauses})`];
        const params: unknown[] = [q];

        const scope = scopeCond(appUser, 'country_code', params);
        if (scope) conditions.push(scope);

        const sql = `SELECT *, ${simExpr} AS score FROM ${tbl}
          WHERE ${conditions.join(' AND ')}
          ORDER BY score DESC LIMIT 20`;
        const result = await client.query(sql, params);
        res.json(result.rows);
      });
    }));

  // ── GET BY ID ───────────────────────────────────────────
  router.get('/:id', asyncHandler(async (req, res) => {
    const email = req.headers['x-mdm-user'] as string;
    const { tbl, scopeCond, selectCols, joinSql } = current();
    return withUser(email, async (client, appUser) => {
      const conditions = [`t.id = $1`];
      const params: unknown[] = [req.params.id];

      const scope = scopeCond(appUser, 't.country_code', params);
      if (scope) conditions.push(scope);

      const sql = `SELECT ${selectCols} FROM ${tbl} t${joinSql} WHERE ${conditions.join(' AND ')}`;
      const result = await client.query(sql, params);
      if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(result.rows[0]);
    });
  }));

  // ── CREATE ──────────────────────────────────────────────
  router.post('/', asyncHandler(async (req, res) => {
    const email = req.headers['x-mdm-user'] as string;
    const { mod, tbl, activeFieldNames, hasCountry } = current();
    return withUser(email, async (client, appUser) => {
      const body = req.body;
      if (hasCountry) {
        const denied = checkWriteCountry(appUser, mod.id, body.country_code);
        if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
      }
      const cols: string[] = [];
      const vals: unknown[] = [];
      const placeholders: string[] = [];
      let pi = 1;

      // Common MDM columns
      for (const col of ['source_system', 'source_id', ...activeFieldNames.filter(c => !PROTECTED_COLUMNS.has(c)), 'extended_attrs']) {
        if (body[col] !== undefined) {
          cols.push(col);
          vals.push(col === 'extended_attrs' ? JSON.stringify(body[col] || {}) : body[col]);
          placeholders.push(`$${pi++}`);
        }
      }

      cols.push('created_by', 'updated_by');
      vals.push(email, email);
      placeholders.push(`$${pi++}`, `$${pi++}`);

      const sql = `INSERT INTO ${tbl} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const result = await client.query(sql, vals);
      const record = result.rows[0];
      // The onboarding workflow is created by the trg_auto_onboarding insert trigger (migration 016).

      res.status(201).json(record);
    });
  }));

  // ── UPDATE ──────────────────────────────────────────────
  router.put('/:id', asyncHandler(async (req, res) => {
    const email = req.headers['x-mdm-user'] as string;
    const { mod, tbl, entityType, activeFieldNames, hasCountry, scopeCond } = current();
    return withUser(email, async (client, appUser) => {
      const body = { ...req.body };
      if (body.country_code === '') body.country_code = null;
      if (hasCountry && body.country_code !== undefined) {
        const cur = await client.query(`SELECT country_code FROM ${tbl} WHERE id = $1`, [req.params.id]);
        if (cur.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
        const denied = countryChanged(cur.rows[0].country_code, body.country_code)
          ? checkWriteCountry(appUser, mod.id, body.country_code) : null;
        if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
      }

      // Hierarchy in workflow mode: a parent change opens a HIERARCHY_CHANGE workflow instead of applying;
      // the other fields of the same request are still saved.
      let hierarchyWorkflow: { id: number; status: string; message: string } | null = null;
      const hier = mod.hierarchy;
      if (hier?.enabled && hier.change_mode === 'workflow') {
        const parentField = assertIdent(hier.parent_field || 'parent_id', 'parent field');
        if (body[parentField] !== undefined) {
          const cur = await client.query(`SELECT ${parentField} AS parent, lifecycle_stage FROM ${tbl} WHERE id = $1 AND is_deleted = false`, [req.params.id]);
          if (cur.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
          const oldParent = cur.rows[0].parent;
          const newParent = body[parentField];
          if (String(oldParent ?? '') !== String(newParent ?? '')) {
            const open = await pool.query(
              `SELECT id FROM mdm.workflow_instance WHERE entity_id = $1 AND entity_type = $2
                  AND workflow_type = 'HIERARCHY_CHANGE' AND completed_at IS NULL`, [req.params.id, entityType]);
            if (open.rows.length) {
              res.status(409).json({ error: 'A hierarchy change workflow is already pending for this record', workflow_id: open.rows[0].id });
              return;
            }
            const payload = { field: parentField, old_value: oldParent, new_value: newParent, entity_stage_at_start: cur.rows[0].lifecycle_stage };
            const wf = await pool.query(
              `INSERT INTO mdm.workflow_instance (entity_type, entity_id, workflow_type, current_stage, assigned_to, priority, created_by, payload, notes)
               VALUES ($1, $2, 'HIERARCHY_CHANGE', 'DRAFT', $3, 'HIGH', $3, $4, 'Hierarchy change: move to new parent') RETURNING id`,
              [entityType, req.params.id, email, JSON.stringify(payload)]);
            hierarchyWorkflow = { id: wf.rows[0].id, status: 'DRAFT', message: 'Hierarchy change requires workflow approval' };
          }
          delete body[parentField];
        }
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      let pi = 1;

      // System columns (lifecycle, scores, identity) are never set here: see PROTECTED_COLUMNS
      reportIgnored(res, Object.keys(body).filter(k => PROTECTED_COLUMNS.has(k)));
      const json = await writableJsonCols(tbl);
      for (const col of [...activeFieldNames.filter(c => !json.includes(c)), ...json]) {
        if (body[col] !== undefined && !PROTECTED_COLUMNS.has(col)) {
          sets.push(`${col} = $${pi++}`);
          vals.push(json.includes(col) ? JSON.stringify(body[col]) : body[col]);
        }
      }

      if (sets.length === 0) {
        if (hierarchyWorkflow) {
          const rec = await client.query(`SELECT * FROM ${tbl} WHERE id = $1`, [req.params.id]);
          res.json({ ...rec.rows[0], _hierarchy_workflow: hierarchyWorkflow });
          return;
        }
        res.status(400).json({ error: 'No fields to update' }); return;
      }

      sets.push(`updated_by = $${pi++}`, `updated_at = NOW()`);
      vals.push(email);
      vals.push(req.params.id);
      const idParam = pi;
      const scope = scopeCond(appUser, 'country_code', vals);

      const sql = `UPDATE ${tbl} SET ${sets.join(', ')} WHERE id = $${idParam} AND is_deleted = false${scope ? ` AND ${scope}` : ''} RETURNING *`;
      const result = await client.query(sql, vals);
      if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }

      let record = result.rows[0];

      // Post-update hook (e.g. completeness recomputation)
      if (mod.hooks?.after_update) {
        await client.query(`SELECT ${mod.hooks.after_update}($1)`, [req.params.id]);
        const refreshed = await client.query(`SELECT * FROM ${tbl} WHERE id = $1`, [req.params.id]);
        record = refreshed.rows[0] || record;
      }

      res.json(hierarchyWorkflow ? { ...record, _hierarchy_workflow: hierarchyWorkflow } : record);
    });
  }));

  // ── SOFT DELETE ─────────────────────────────────────────
  router.delete('/:id', asyncHandler(async (req, res) => {
    const email = req.headers['x-mdm-user'] as string;
    const { tbl, scopeCond } = current();
    const result = await withUser(email, (client, appUser) => {
      const params: unknown[] = [req.params.id, email];
      const scope = scopeCond(appUser, 'country_code', params);
      return client.query(
        `UPDATE ${tbl} SET is_deleted = true, updated_by = $2, updated_at = NOW() WHERE id = $1${scope ? ` AND ${scope}` : ''}`,
        params
      );
    });
    if (result.rowCount === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ success: true });
  }));

  return router;
}
