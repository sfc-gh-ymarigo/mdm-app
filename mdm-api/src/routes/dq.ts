import { Router } from 'express';
import pool, { getAppUser, userDb, withUser } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { visibleEntity } from '../scope.js';
import { entityInfo } from '../modules/entities.js';
import { getModule } from '../config.js';
import { ALL_TEMPLATES, getApplicableTemplates, generateRule, type FieldMeta } from '../dq-templates.js';
import { validateRuleExpression, SqlGuardError } from '../sqlGuard.js';
import { parsePaging, pagedSql, pagedResult, wrap } from '../lib/paging.js';

const router = Router();

// ── Rule expression safety ────────────────────────────────────────────────────
// Template rules are regenerated from their template at run time (the stored text is not
// trusted); custom rules must pass validateRuleExpression against the table's columns.
const _cols = new Map<string, { at: number; cols: Set<string> }>();
let _fns: { at: number; fns: Set<string> } | null = null;

async function tableColumns(table: string): Promise<Set<string>> {
  const hit = _cols.get(table);
  if (hit && Date.now() - hit.at < 60_000) return hit.cols;
  const [schema, name] = table.split('.');
  const r = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', [schema, name]);
  const cols = new Set<string>(r.rows.map((x: { column_name: string }) => x.column_name));
  _cols.set(table, { at: Date.now(), cols });
  return cols;
}

async function validationFunctions(): Promise<Set<string>> {
  if (_fns && Date.now() - _fns.at < 60_000) return _fns.fns;
  const r = await pool.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'mdm' AND p.proname LIKE 'fn\\_%'`);
  _fns = { at: Date.now(), fns: new Set(r.rows.map((x: { proname: string }) => x.proname)) };
  return _fns.fns;
}

export async function checkCustomExpression(entityType: string, expr: unknown): Promise<string> {
  const { table } = entityInfo(entityType, { includeDisabled: true });
  return validateRuleExpression(expr, await tableColumns(table), await validationFunctions());
}

type StoredRule = { id: number; rule_code: string; severity?: string; sql_expression: string; source?: string; field_name?: string; template_id?: string };

/** Returns the SQL to evaluate for a stored rule, or an error string when it must be skipped. */
async function executableSql(entityType: string, rule: StoredRule): Promise<{ sql?: string; error?: string }> {
  if (rule.source === 'TEMPLATE') {
    const mod = getModule(entityType.toLowerCase());
    const field = mod?.fields.find((f: FieldMeta) => f.name === rule.field_name) as FieldMeta | undefined;
    const template = ALL_TEMPLATES.find(t => t.id === rule.template_id);
    if (!field || !template) return { error: 'template or field no longer exists' };
    try { return { sql: generateRule(template, field, entityType).sql_expression }; }
    catch (e) { return { error: (e as Error).message }; }
  }
  try { return { sql: await checkCustomExpression(entityType, rule.sql_expression) }; }
  catch (e) { return { error: e instanceof SqlGuardError ? e.message : 'invalid expression' }; }
}

// Snapshot current DQ results into run history
async function recordRunHistory(entityType: string, ruleIds?: number[]) {
  const filter = ruleIds ? 'AND dr.rule_id = ANY($2)' : '';
  const params: unknown[] = [entityType];
  if (ruleIds) params.push(ruleIds);
  await pool.query(`
    INSERT INTO mdm.dq_run_history (rule_id, entity_type, total, passed, failed, pass_rate, run_at)
    SELECT dr.rule_id, dr.entity_type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE dr.passed)::int AS passed,
      COUNT(*) FILTER (WHERE NOT dr.passed)::int AS failed,
      ROUND(100.0 * COUNT(*) FILTER (WHERE dr.passed) / NULLIF(COUNT(*), 0), 2) AS pass_rate,
      NOW()
    FROM mdm.dq_result dr
    WHERE dr.entity_type = $1 ${filter}
    GROUP BY dr.rule_id, dr.entity_type
  `, params);
}

// List all rules (with latest results, scoped by country)
router.get('/rules', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  // Results only count entities visible to the caller (Postgres RLS on entity tables)
  const scopeJoin = `LEFT JOIN mdm.dq_result dr ON dr.rule_id = r.id AND ${visibleEntity('dr.entity_type', 'dr.entity_id')}`;
  const params: unknown[] = [];
  const p = parsePaging(req, {
    rule_code: 'rule_code', rule_name: 'rule_name', entity_type: 'entity_type', rule_type: 'rule_type',
    severity: 'severity', total: 'total', passed: 'passed', failed: 'failed', is_active: 'is_active',
  }, 'entity_type, rule_code');
  let sql = wrap(`
    SELECT r.*,
      COUNT(dr.id)::int AS total,
      COUNT(*) FILTER (WHERE dr.passed = true)::int AS passed,
      COUNT(*) FILTER (WHERE dr.passed = false)::int AS failed
    FROM mdm.dq_rule r
    ${scopeJoin}
    GROUP BY r.id`);
  const where: string[] = [];
  for (const f of ['entity_type', 'rule_type', 'severity']) {
    const v = req.query[f];
    if (typeof v === 'string' && v) { params.push(v); where.push(`${f} = $${params.length}`); }
  }
  if (p.q) { params.push(`%${p.q}%`); where.push(`(rule_code ILIKE $${params.length} OR rule_name ILIKE $${params.length})`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  const result = await userDb(user).query(pagedSql(sql, p, params), params);
  res.json(pagedResult(result.rows, p));
}));

// Create a new rule (editors/admins only)
router.post('/rules', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  // Custom expressions are admin-only; stewards build rules from templates
  if (appUser.role !== 'ADMIN') { res.status(403).json({ error: 'Only administrators can create custom DQ rules; use templates instead' }); return; }
  const { entity_type, rule_code, rule_name, rule_type, severity, category } = req.body;
  if (!entity_type || !rule_code || !rule_name || !rule_type || !req.body.sql_expression) {
    res.status(400).json({ error: 'Missing required fields: entity_type, rule_code, rule_name, rule_type, sql_expression' });
    return;
  }
  entityInfo(entity_type); // 400 for unknown types
  const sql_expression = await checkCustomExpression(String(entity_type).toUpperCase(), req.body.sql_expression);
  const result = await pool.query(
    `INSERT INTO mdm.dq_rule (entity_type, rule_code, rule_name, rule_type, severity, sql_expression, category, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'MANUAL') RETURNING *`,
    [String(entity_type).toUpperCase(), rule_code, rule_name, rule_type, severity || 'WARNING', sql_expression, category || null]
  );
  res.status(201).json(result.rows[0]);
}));

// Update a rule (editors/admins only)
router.put('/rules/:id', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  if (appUser.role === 'VIEWER') { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const fields = { ...req.body };
  const keys = Object.keys(fields).filter(k => ['rule_name', 'rule_type', 'severity', 'sql_expression', 'category', 'is_active'].includes(k));
  if (keys.length === 0) { res.status(400).json({ error: 'No valid fields to update' }); return; }
  if (keys.includes('sql_expression')) {
    if (appUser.role !== 'ADMIN') { res.status(403).json({ error: 'Only administrators can change rule expressions' }); return; }
    const cur = await pool.query('SELECT entity_type, source FROM mdm.dq_rule WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) { res.status(404).json({ error: 'Rule not found' }); return; }
    if (cur.rows[0].source === 'TEMPLATE') { res.status(400).json({ error: 'Template rules are generated; change the template selection instead' }); return; }
    fields.sql_expression = await checkCustomExpression(cur.rows[0].entity_type, fields.sql_expression);
  }
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
  const result = await pool.query(
    `UPDATE mdm.dq_rule SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [req.params.id, ...keys.map(k => fields[k])]
  );
  if (result.rows.length === 0) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json(result.rows[0]);
}));

// Delete a rule (editors/admins only)
router.delete('/rules/:id', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  if (appUser.role === 'VIEWER') { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const cur = await pool.query('SELECT source FROM mdm.dq_rule WHERE id = $1', [req.params.id]);
  if (cur.rows[0] && cur.rows[0].source !== 'TEMPLATE' && appUser.role !== 'ADMIN') {
    res.status(403).json({ error: 'Only administrators can delete custom DQ rules' }); return;
  }
  await pool.query('DELETE FROM mdm.dq_result WHERE rule_id = $1', [req.params.id]);
  const result = await pool.query('DELETE FROM mdm.dq_rule WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json({ deleted: true });
}));

router.get('/failures/:ruleId', asyncHandler(async (req, res) => {
  const ruleId = parseInt(req.params.ruleId, 10);
  if (isNaN(ruleId)) { res.status(400).json({ error: 'Invalid rule ID' }); return; }

  const ruleResult = await pool.query('SELECT id, entity_type, rule_code, rule_name FROM mdm.dq_rule WHERE id = $1', [ruleId]);
  if (ruleResult.rows.length === 0) { res.status(404).json({ error: 'Rule not found' }); return; }
  const rule = ruleResult.rows[0];
  const entityType = rule.entity_type;

  const ent = entityInfo(entityType, { includeDisabled: true });
  const active = new Set(ent.mod.fields.filter(f => f.active !== false).map(f => f.name));
  const extra = ['tax_id', 'country_code', 'city', 'sku'].filter(c => active.has(c)).map(c => `t.${c}`);
  let joinSql = '';
  for (const j of ent.mod.joins || []) {
    joinSql += ` LEFT JOIN ${j.table} ${j.alias} ON ${j.on.replace('{table}', 't')}`;
    for (const [alias, expr] of Object.entries(j.columns)) extra.push(`${expr} AS ${alias}`);
  }
  const p = parsePaging(req, { name: 'name', evaluated_at: 'evaluated_at', lifecycle_stage: 'lifecycle_stage' }, 'name, entity_id');
  const params: unknown[] = [ruleId];
  let query = wrap(`
    SELECT dr.entity_id, t.${ent.nameCol}::text AS name, ${extra.map(e => `${e}, `).join('')}t.lifecycle_stage, dr.evaluated_at
    FROM mdm.dq_result dr
    JOIN ${ent.table} t ON t.id = dr.entity_id${joinSql}
    WHERE dr.rule_id = $1 AND dr.passed = false`);
  if (p.q) { params.push(`%${p.q}%`); query += ` WHERE name ILIKE $2`; }

  // Entity JOINs run under RLS, so failures outside the caller's scope are hidden
  const result = await userDb(req.headers['x-mdm-user'] as string).query(pagedSql(query, p, params), params);
  const shaped = pagedResult(result.rows, p);
  res.json(Array.isArray(shaped) ? { rule, failures: shaped } : { rule, failures: shaped.rows, total: shaped.total, page: shaped.page, size: shaped.size });
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const scopeJoin = `LEFT JOIN mdm.dq_result dr ON dr.rule_id = r.id AND ${visibleEntity('dr.entity_type', 'dr.entity_id')}`;
  const params: unknown[] = [];

  const result = await userDb(user).query(`
    SELECT r.rule_code, r.rule_name, r.rule_type, r.severity,
      COUNT(dr.id)::int AS total,
      COUNT(*) FILTER (WHERE dr.passed = true)::int AS passed,
      COUNT(*) FILTER (WHERE dr.passed = false)::int AS failed,
      CASE WHEN COUNT(dr.id) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE dr.passed) / COUNT(dr.id), 2)::float
        ELSE 0
      END AS pass_rate
    FROM mdm.dq_rule r
    ${scopeJoin}
    WHERE r.is_active = true
    GROUP BY r.id, r.rule_code, r.rule_name, r.rule_type, r.severity
    ORDER BY r.rule_code
  `, params);
  res.json(result.rows);
}));

type RunSummary = { rules: number; entities: number; inserted: number; runRuleIds: number[]; skipped: { rule_code: string; reason: string }[] };

/**
 * Evaluates active rules for one entity type in a single transaction on the caller's connection
 * (Postgres RLS limits the run to entities in the user's country scope). Each rule is one set-based
 * INSERT … SELECT; previous results for the evaluated rules are replaced and scores recomputed.
 * Any failure rolls the whole run back, so results are never left half-written.
 */
export async function runRules(user: string, entityType: string, table: string, ruleIds?: number[]): Promise<RunSummary | null> {
  return withUser(user, async (client) => {
    const filter = ruleIds?.length ? 'AND id = ANY($2)' : '';
    const rules = (await client.query(
      `SELECT id, rule_code, severity, sql_expression, source, field_name, template_id FROM mdm.dq_rule
        WHERE entity_type = $1 AND is_active = true ${filter} ORDER BY rule_code`,
      ruleIds?.length ? [entityType, ruleIds] : [entityType])).rows as StoredRule[];
    if (rules.length === 0) return null;

    // Resolve executable SQL before touching any data
    const skipped: RunSummary['skipped'] = [];
    const runnable: { id: number; sql: string }[] = [];
    for (const rule of rules) {
      const exe = await executableSql(entityType, rule);
      if (exe.sql) runnable.push({ id: rule.id, sql: exe.sql });
      else skipped.push({ rule_code: rule.rule_code, reason: exe.error || 'invalid' });
    }
    const runRuleIds = rules.map(r => r.id);

    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM mdm.dq_result dr WHERE dr.entity_type = $1 AND dr.rule_id = ANY($2) AND ${visibleEntity('dr.entity_type', 'dr.entity_id')}`,
        [entityType, runRuleIds]);
      let inserted = 0;
      for (const r of runnable) {
        const ins = await client.query(
          `INSERT INTO mdm.dq_result (rule_id, entity_type, entity_id, passed, evaluated_at)
           SELECT $1, $2, id, COALESCE((${r.sql}), false), NOW() FROM ${table} WHERE is_deleted = false`,
          [r.id, entityType]);
        inserted += ins.rowCount ?? 0;
      }
      // Recompute dq_score and completeness per entity (always uses ALL results, not just the run subset)
      await client.query(`
        UPDATE ${table} t SET dq_score = sub.dq_score, completeness = sub.completeness, last_dq_check = NOW()
        FROM (
          SELECT dr.entity_id,
            ROUND(100.0 * COUNT(*) FILTER (WHERE dr.passed AND r.severity = 'ERROR')
              / NULLIF(COUNT(*) FILTER (WHERE r.severity = 'ERROR'), 0), 2) AS dq_score,
            ROUND(100.0 * COUNT(*) FILTER (WHERE dr.passed) / NULLIF(COUNT(*), 0), 2) AS completeness
          FROM mdm.dq_result dr JOIN mdm.dq_rule r ON r.id = dr.rule_id
          WHERE dr.entity_type = $1
          GROUP BY dr.entity_id
        ) sub WHERE t.id = sub.entity_id`, [entityType]);
      const entities = Number((await client.query(`SELECT COUNT(*) AS n FROM ${table} WHERE is_deleted = false`)).rows[0].n);
      await client.query('COMMIT');
      return { rules: rules.length, entities, inserted, runRuleIds, skipped };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });
}

router.post('/run/:entity_type', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  if (appUser.role === 'VIEWER') { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const { type: entityType, table } = entityInfo(req.params.entity_type);
  const summary = await runRules(user, entityType, table, req.body.rule_ids);
  if (!summary) { res.json({ status: 'no_rules', entity_type: entityType, evaluated: 0 }); return; }

  // Record run history snapshot (global: recomputed from all countries' current results)
  await recordRunHistory(entityType, summary.runRuleIds);

  res.json({
    status: 'complete',
    entity_type: entityType,
    rules_evaluated: summary.rules,
    entities_checked: summary.entities,
    results_written: summary.inserted,
    skipped_rules: summary.skipped,
  });
}));

// GET /history — last N run snapshots per rule (for trend charts)
router.get('/history', asyncHandler(async (req, res) => {
  const entityType = (req.query.entity_type as string || '').toUpperCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
  const filter = entityType ? 'WHERE h.entity_type = $2' : '';
  const params: unknown[] = [limit];
  if (entityType) params.push(entityType);
  const { rows } = await pool.query(`
    SELECT h.rule_id, r.rule_code, r.rule_name, h.entity_type,
      h.total, h.passed, h.failed, h.pass_rate, h.run_at
    FROM mdm.dq_run_history h
    JOIN mdm.dq_rule r ON r.id = h.rule_id
    ${filter}
    ORDER BY h.run_at DESC
    LIMIT $1 * (SELECT COUNT(DISTINCT rule_id) FROM mdm.dq_run_history)
  `, params);
  // Group by rule_code
  const grouped: Record<string, { rule_code: string; rule_name: string; entity_type: string; runs: { pass_rate: number; total: number; passed: number; failed: number; run_at: string }[] }> = {};
  for (const r of rows) {
    if (!grouped[r.rule_code]) grouped[r.rule_code] = { rule_code: r.rule_code, rule_name: r.rule_name, entity_type: r.entity_type, runs: [] };
    if (grouped[r.rule_code].runs.length < limit) {
      grouped[r.rule_code].runs.push({ pass_rate: parseFloat(r.pass_rate), total: r.total, passed: r.passed, failed: r.failed, run_at: r.run_at });
    }
  }
  // Reverse runs so oldest first (for sparklines)
  for (const g of Object.values(grouped)) g.runs.reverse();
  res.json(Object.values(grouped));
}));

// ── DQ Template Configuration ─────────────────────────────────────────────────

// GET /templates/:entityType — returns fields, applicable templates, and current selections
router.get('/templates/:entityType', asyncHandler(async (req, res) => {
  const entityType = req.params.entityType.toUpperCase();
  const moduleId = entityType.toLowerCase();
  const mod = getModule(moduleId);
  if (!mod) { res.status(404).json({ error: `Module ${moduleId} not found` }); return; }

  // Get active fields from config
  const activeFields: FieldMeta[] = mod.fields
    .filter((f: FieldMeta & { active?: boolean }) => f.active !== false)
    .map((f: FieldMeta & { active?: boolean }) => ({
      name: f.name, label: f.label || f.name, type: f.type, group: f.group,
      required: f.required, ref_domain: f.ref_domain, max_length: f.max_length,
    }));

  // Get existing template rules from DB
  const existing = await pool.query(
    `SELECT field_name, template_id, severity, is_active, id FROM mdm.dq_rule WHERE entity_type = $1 AND source = 'TEMPLATE'`,
    [entityType]
  );
  const existingMap = new Map<string, { severity: string; is_active: boolean; id: number }>();
  for (const row of existing.rows) {
    existingMap.set(`${row.field_name}::${row.template_id}`, { severity: row.severity, is_active: row.is_active, id: row.id });
  }

  // Build response: fields grouped, with applicable templates and current state
  const groups = new Map<string, Array<{
    field: FieldMeta;
    templates: Array<{
      id: string; label: string; description: string; ruleType: string; defaultSeverity: string;
      selected: boolean; severity: string; ruleId?: number;
    }>;
  }>>();

  for (const field of activeFields) {
    const applicable = getApplicableTemplates(field);
    if (applicable.length === 0) continue;

    const templates = applicable.map(t => {
      const key = `${field.name}::${t.id}`;
      const ex = existingMap.get(key);
      return {
        id: t.id,
        label: t.label,
        description: t.description,
        ruleType: t.ruleType,
        defaultSeverity: t.defaultSeverity,
        selected: ex?.is_active ?? false,
        severity: ex?.severity ?? t.defaultSeverity,
        ruleId: ex?.id,
      };
    });

    const group = field.group || 'other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ field, templates });
  }

  // Convert to ordered array
  const fieldGroups = Array.from(groups.entries()).map(([group, fields]) => ({ group, fields }));

  // Coverage stats
  const totalFields = activeFields.length;
  const coveredFields = new Set(existing.rows.filter((r: { is_active: boolean }) => r.is_active).map((r: { field_name: string }) => r.field_name)).size;

  // Custom (manual) rules count
  const customResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM mdm.dq_rule WHERE entity_type = $1 AND (source = 'MANUAL' OR source IS NULL)`,
    [entityType]
  );

  res.json({
    entityType,
    totalFields,
    coveredFields,
    customRuleCount: customResult.rows[0].count,
    fieldGroups,
    availableTemplates: ALL_TEMPLATES.map(t => ({ id: t.id, label: t.label, description: t.description, ruleType: t.ruleType, defaultSeverity: t.defaultSeverity })),
  });
}));

// POST /templates/:entityType/apply — batch apply template selections
router.post('/templates/:entityType/apply', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  if (appUser.role === 'VIEWER') { res.status(403).json({ error: 'Insufficient permissions' }); return; }

  const entityType = req.params.entityType.toUpperCase();
  const moduleId = entityType.toLowerCase();
  const mod = getModule(moduleId);
  if (!mod) { res.status(404).json({ error: `Module ${moduleId} not found` }); return; }

  const { selections } = req.body as {
    selections: Array<{ fieldName: string; templateId: string; severity: string; selected: boolean }>;
  };

  if (!selections || !Array.isArray(selections)) {
    res.status(400).json({ error: 'selections array required' }); return;
  }

  let created = 0;
  let activated = 0;
  let deactivated = 0;

  for (const sel of selections) {
    const field = mod.fields.find((f: FieldMeta) => f.name === sel.fieldName) as FieldMeta | undefined;
    const template = ALL_TEMPLATES.find(t => t.id === sel.templateId);
    if (!field || !template) continue;

    // Check if rule already exists
    const existing = await pool.query(
      `SELECT id, is_active FROM mdm.dq_rule WHERE entity_type = $1 AND source = 'TEMPLATE' AND field_name = $2 AND template_id = $3`,
      [entityType, sel.fieldName, sel.templateId]
    );

    if (existing.rows.length > 0) {
      // Update: activate/deactivate + update severity
      const row = existing.rows[0];
      if (sel.selected && !row.is_active) {
        await pool.query(`UPDATE mdm.dq_rule SET is_active = true, severity = $2 WHERE id = $1`, [row.id, sel.severity]);
        activated++;
      } else if (!sel.selected && row.is_active) {
        await pool.query(`UPDATE mdm.dq_rule SET is_active = false WHERE id = $1`, [row.id]);
        deactivated++;
      } else if (sel.selected) {
        // Just update severity if changed
        await pool.query(`UPDATE mdm.dq_rule SET severity = $2 WHERE id = $1`, [row.id, sel.severity]);
      }
    } else if (sel.selected) {
      // Create new template rule
      const rule = generateRule(template, field, entityType, sel.severity);
      await pool.query(
        `INSERT INTO mdm.dq_rule (entity_type, rule_code, rule_name, rule_type, severity, sql_expression, source, field_name, template_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
         ON CONFLICT DO NOTHING`,
        [rule.entity_type, rule.rule_code, rule.rule_name, rule.rule_type, rule.severity, rule.sql_expression, rule.source, rule.field_name, rule.template_id]
      );
      created++;
    }
  }

  res.json({ status: 'applied', created, activated, deactivated, total_changes: created + activated + deactivated });
}));

export default router;
