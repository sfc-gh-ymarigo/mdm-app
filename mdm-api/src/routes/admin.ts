import { Router } from 'express';
import { sfQuery, SF_AUTH_MODE } from '../snowflake.js';
import { sfObjects, sfName, setConfigActor, getModules, getModule, setModuleEnabled, setModuleProperty, setFieldActive, addCustomField, deleteCustomField, updateHierarchyConfig, updateMatchingConfig,
  getLanguages, addLanguage, setDefaultLanguage, setLanguageEnabled,
  getCountries, addCountry, setCountryEnabled, loadConfig, saveConfig,
  getBranding, validateBranding, setBranding, DEFAULT_BRANDING } from '../config.js';
import pool from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { requireAdmin } from '../middleware/requireRole.js';
import { syncModuleScope } from '../scope.js';
import { validateFunctionDdl, isIdent } from '../sqlGuard.js';
import { pickModel } from '../cortex.js';
import { unmaskRoles, piiFields, canSeePii, resetPiiCache } from '../pii.js';
import { NON_CODELIST_DOMAIN_COUNT } from './refdata.js';
import { scheduleModuleSync, moduleSyncState } from '../moduleSync.js';

const router = Router();

// All admin routes require ADMIN role
router.use(requireAdmin);
// Config saves made through admin routes are attributed to the caller in app_config_history
router.use((req, _res, next) => { setConfigActor(req.headers['x-mdm-user'] as string); next(); });

// Role for Snowflake ops calls (mirror, dynamic tables). Unset = the service's own role.
const OPS_ROLE = process.env.MDM_SF_OPS_ROLE || undefined;
// Snowflake object stem per module table (mdm.customer → CUSTOMER), as built by SYNC_MODULES
function moduleStems(enabledOnly = false) {
  return getModules()
    .filter(m => !enabledOnly || m.enabled)
    .map(m => ({ id: m.id, label: m.label, stem: m.table.split('.').pop()!.toUpperCase(), table: m.table }))
    .filter(m => /^[A-Z_][A-Z0-9_]*$/.test(m.stem) && /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(m.table));
}
const historyTables = () => moduleStems().map(m => `${m.stem}_HISTORY`);

const LAG_RE = /^\d{1,4} (second|seconds|minute|minutes|hour|hours|day|days)$|^DOWNSTREAM$/i;

// GET /api/admin/health — system health overview
router.get('/health', asyncHandler(async (_req, res) => {
  const checks: Record<string, unknown> = {};

  // 1. Postgres health
  try {
    const t0 = Date.now();
    const pgResult = await pool.query('SELECT 1 AS ok, NOW() AS server_time');
    checks.postgres = {
      status: 'healthy',
      latency_ms: Date.now() - t0,
      server_time: pgResult.rows[0].server_time,
    };
  } catch (e: any) {
    checks.postgres = { status: 'error', error: e.message };
  }

  // 2. Postgres table counts
  try {
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM mdm.workflow_instance WHERE completed_at IS NULL) AS open_workflows,
        (SELECT COUNT(*)::int FROM mdm.match_candidate WHERE status = 'PENDING') AS pending_matches,
        (SELECT COUNT(*)::int FROM mdm.audit_log) AS audit_entries,
        (SELECT COUNT(*)::int FROM mdm.dq_rule WHERE is_active = true) AS active_dq_rules,
        (SELECT COUNT(*)::int FROM mdm.ref_codelist) AS codelist_entries,
        -- same domains as the Reference Data page: codelists + built-in tables + lifecycle stages
        ((SELECT COUNT(DISTINCT domain) FROM mdm.ref_codelist) + $1)::int AS codelist_domains
    `, [NON_CODELIST_DOMAIN_COUNT]);
    const mods = moduleStems(true);
    const ent = mods.length ? await pool.query(
      mods.map(m => `SELECT '${m.id}' AS id, COUNT(*)::int AS count FROM ${m.table} WHERE is_deleted = false`).join(' UNION ALL ')) : { rows: [] };
    checks.postgres_data = {
      ...counts.rows[0],
      entities: mods.map(m => ({ id: m.id, label: m.label, count: ent.rows.find((r: any) => r.id === m.id)?.count ?? 0 })),
    };
  } catch (e: any) {
    checks.postgres_data = { error: e.message };
  }

  // 3. Snowflake connectivity
  try {
    const t0 = Date.now();
    const sfResult = await sfQuery('SELECT CURRENT_TIMESTAMP() AS ts, CURRENT_WAREHOUSE() AS wh, CURRENT_ROLE() AS rl');
    checks.snowflake = {
      status: 'healthy',
      auth_mode: SF_AUTH_MODE,
      latency_ms: Date.now() - t0,
      warehouse: sfResult[0]?.WH,
      role: sfResult[0]?.RL,
      server_time: sfResult[0]?.TS,
    };
  } catch (e: any) {
    checks.snowflake = { status: 'error', auth_mode: SF_AUTH_MODE, error: e.message };
  }

  res.json(checks);
}));

// GET /api/admin/mirror — CDC mirror status. The mirror procedures need the instance owner, so the
// service role goes through the owner's-rights wrapper MDM_AI.GET_MIRROR_STATUS (snowflake/007).
router.get('/mirror', asyncHandler(async (_req, res) => {
  try {
    const rows = await sfQuery(`CALL ${sfObjects().database}.MDM_AI.GET_MIRROR_STATUS()`, OPS_ROLE);
    const raw = rows[0]?.GET_MIRROR_STATUS;
    const mirror: Record<string, any> = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
    if (!mirror.MIRROR_NAME) return res.json({ status: 'error', error: 'Mirror not found' });

    res.json({
      mirror_name: mirror.MIRROR_NAME,
      status: mirror.STATUS,
      table_count: mirror.TABLE_COUNT,
      refresh_interval: mirror.REFRESH_INTERVAL,
      last_apply_time: mirror.LAST_APPLY_TIME,
      last_operation_time: mirror.LAST_OPERATION_TIME,
      current_lag_seconds: mirror.CURRENT_LAG_SECONDS ?? null,
      snapshot_remaining: mirror.INITIAL_SNAPSHOT_TABLES_REMAINING,
      error_message: mirror.ERROR_MESSAGE || null,
    });
  } catch (e: any) {
    res.json({ status: 'error', error: e.message });
  }
}));

// GET /api/admin/dynamic-tables — dynamic table status
router.get('/dynamic-tables', asyncHandler(async (_req, res) => {
  try {
    const showRows = await sfQuery(
      `SHOW DYNAMIC TABLES IN SCHEMA ${sfObjects().database}.${sfObjects().analyticsSchema}`
    );

    // Get Snowflake server time to compute lag without timezone issues
    const nowRow = await sfQuery(`SELECT CURRENT_TIMESTAMP() AS ts`);
    const sfNow = new Date(nowRow[0]?.TS as string).getTime();

    const tables = showRows.map((r: any) => {
      const dataTs = r.data_timestamp ? new Date(r.data_timestamp).getTime() : null;
      const lagSeconds = (dataTs && sfNow) ? Math.round((sfNow - dataTs) / 1000) : null;
      return {
        name: r.name,
        rows: r.rows,
        bytes: r.bytes,
        target_lag: r.target_lag,
        refresh_mode: r.refresh_mode,
        scheduling_state: r.scheduling_state,
        data_timestamp: r.data_timestamp,
        current_lag_seconds: lagSeconds,
      };
    });

    // Fetch recent refresh history
    const history = await sfQuery(`
      SELECT name, state, refresh_start_time, refresh_end_time,
             DATEDIFF('millisecond', refresh_start_time, refresh_end_time) AS duration_ms
      FROM SNOWFLAKE.ACCOUNT_USAGE.DYNAMIC_TABLE_REFRESH_HISTORY
      WHERE schema_name = '${sfObjects().analyticsSchema}' AND database_name = '${sfObjects().database}'
      ORDER BY refresh_start_time DESC LIMIT 10
    `).catch(() => []);

    res.json({ tables, recent_refreshes: history });
  } catch (e: any) {
    res.json({ status: 'error', error: e.message });
  }
}));

// PUT /api/admin/dynamic-tables/:name/lag — update target lag
router.put('/dynamic-tables/:name/lag', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const { target_lag } = req.body;
  const allowed = historyTables();
  if (!allowed.includes(name.toUpperCase())) {
    return res.status(400).json({ error: `Invalid dynamic table: ${name}` });
  }
  if (!target_lag || typeof target_lag !== 'string') {
    return res.status(400).json({ error: 'target_lag is required (e.g. "5 minutes")' });
  }
  if (!LAG_RE.test(target_lag.trim())) return res.status(400).json({ error: 'target_lag must look like "5 minutes" or DOWNSTREAM' });
  try {
    await sfQuery(
      `ALTER DYNAMIC TABLE ${sfName(name.toUpperCase())} SET TARGET_LAG = '${target_lag}'`,
      OPS_ROLE
    );
    res.json({ success: true, name: name.toUpperCase(), target_lag });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));

// PUT /api/admin/mirror/lag — update CDC mirror refresh interval
router.put('/mirror/lag', asyncHandler(async (req, res) => {
  const { refresh_interval } = req.body;
  if (!refresh_interval || typeof refresh_interval !== 'string') {
    return res.status(400).json({ error: 'refresh_interval is required (e.g. "1 minute")' });
  }
  if (!LAG_RE.test(refresh_interval.trim())) return res.status(400).json({ error: 'refresh_interval must look like "1 minute"' });
  try {
    const r = await sfQuery(
      `CALL ${sfObjects().database}.MDM_AI.SET_MIRROR_REFRESH('${refresh_interval.trim()}')`,
      OPS_ROLE
    );
    const msg = String(r[0]?.SET_MIRROR_REFRESH ?? '');
    if (msg !== 'ok') return res.status(400).json({ error: msg || 'Mirror refresh not changed' });
    res.json({ success: true, refresh_interval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));

// POST /api/admin/dynamic-tables/:name/refresh — manually trigger refresh
router.post('/dynamic-tables/:name/refresh', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const allowed = historyTables();
  if (!allowed.includes(name.toUpperCase())) {
    return res.status(400).json({ error: `Invalid dynamic table: ${name}` });
  }
  try {
    await sfQuery(
      `ALTER DYNAMIC TABLE ${sfName(name.toUpperCase())} REFRESH`,
      OPS_ROLE
    );
    res.json({ success: true, name: name.toUpperCase(), message: 'Refresh triggered' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));

// GET /api/admin/scd-stats — SCD layer row count comparison
router.get('/scd-stats', asyncHandler(async (_req, res) => {
  try {
    const mods = moduleStems();
    const mirror = `${sfObjects().mirrorDatabase}.MDM`;
    const rows = mods.length ? await sfQuery(mods.map(m => `
      SELECT '${m.stem}' AS entity,
             (SELECT COUNT(*) FROM ${mirror}.${m.stem}) AS raw_mirror,
             (SELECT COUNT(*) FROM ${sfName(`V_CURRENT_${m.stem}`)}) AS scd1_dedup,
             (SELECT COUNT(*) FROM ${sfName(`V_CURRENT_${m.stem}`)} WHERE is_deleted = FALSE) AS scd1_active,
             (SELECT COUNT(*) FROM ${sfName(`${m.stem}_HISTORY`)}) AS scd2_total,
             (SELECT COUNT(*) FROM ${sfName(`${m.stem}_HISTORY`)} WHERE is_current = TRUE) AS scd2_current`).join('\n      UNION ALL')) : [];
    res.json(rows);
  } catch (e: any) {
    res.json({ error: e.message });
  }
}));

// GET /api/admin/modules — list all modules with enabled state
router.get('/modules', asyncHandler(async (_req, res) => {
  const modules = getModules().map(m => ({
    id: m.id, label: m.label, singular: m.singular, icon: m.icon,
    enabled: m.enabled, allow_create: m.allow_create !== false, order: m.order,
    field_count: m.fields.filter(f => f.active !== false).length,
    field_total: m.fields.length,
    country_scoped: !!m.country_scoped,
    has_matching: !!m.matching?.enabled,
    has_hierarchy: !!m.hierarchy?.enabled,
    has_workflow: !!m.workflow?.auto_create_on_insert,
  }));
  res.json(modules);
}));

// Any successful module/field change rebuilds the Snowflake module objects
router.use('/modules', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400 && !req.path.startsWith('/sync')) scheduleModuleSync(); });
  next();
});

// GET /api/admin/modules/sync — state of the last Snowflake module sync + recent log
router.get('/modules/sync', asyncHandler(async (_req, res) => {
  let log: Record<string, unknown>[] = [];
  try {
    log = await sfQuery(`SELECT synced_at, config_version, module, status, detail FROM ${sfObjects().database}.MDM_AI.MODULE_SYNC_LOG ORDER BY synced_at DESC LIMIT 50`, OPS_ROLE);
  } catch { /* Snowflake unavailable: report the in-process state only */ }
  res.json({ ...moduleSyncState(), log });
}));

// POST /api/admin/modules/sync — resynchronise now
router.post('/modules/sync', asyncHandler(async (_req, res) => {
  scheduleModuleSync();
  res.status(202).json(moduleSyncState());
}));

// PUT /api/admin/modules/:id — toggle module enabled state
router.put('/modules/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { enabled, allow_create, country_scoped, country_null_all } = req.body;
  const mod = getModule(id);
  if (!mod) return res.status(404).json({ error: `Module "${id}" not found` });
  if (typeof enabled === 'boolean') setModuleEnabled(id, enabled);
  if (typeof allow_create === 'boolean') setModuleProperty(id, 'allow_create', allow_create);
  if (typeof country_null_all === 'boolean') setModuleProperty(id, 'country_null_all', country_null_all);
  if (typeof country_scoped === 'boolean') {
    setModuleProperty(id, 'country_scoped', country_scoped);
    // Postgres RLS policies read the toggle from mdm.module_scope
    await syncModuleScope(id);
  }
  const updated = getModule(id)!;
  res.json({ id: updated.id, label: updated.label, enabled: updated.enabled, allow_create: updated.allow_create !== false, country_scoped: !!updated.country_scoped });
}));

// PUT /api/admin/modules/:id/hierarchy — update hierarchy configuration
router.put('/modules/:id/hierarchy', asyncHandler(async (req, res) => {
  const result = updateHierarchyConfig(req.params.id, req.body);
  if (!result) return res.status(404).json({ error: `Module "${req.params.id}" not found` });
  res.json(result);
}));

// PUT /api/admin/modules/:id/matching — update matching configuration
router.put('/modules/:id/matching', asyncHandler(async (req, res) => {
  const mod = getModule(req.params.id);
  if (!mod) return res.status(404).json({ error: `Module "${req.params.id}" not found` });
  // Matching keys end up as column names in SQL; models go to Cortex — validate both here
  const fieldNames = new Set(mod.fields.map(f => f.name));
  const body = req.body as { fields?: unknown; methods?: Record<string, Record<string, unknown>> };
  const colLists: unknown[] = [body.fields];
  for (const m of Object.values(body.methods || {})) {
    colLists.push(m.keys, m.fields, m.description_fields);
    if (m.name_field !== undefined) colLists.push([m.name_field]);
    if (m.model !== undefined) pickModel(String(m.model), /embed|e5|arctic-embed/i.test(String(m.model)) ? 'embedding' : 'completion');
  }
  for (const list of colLists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Field lists must be arrays' });
    const bad = list.filter(c => !isIdent(c) || !fieldNames.has(c as string));
    if (bad.length) return res.status(400).json({ error: `Unknown fields in matching config: ${bad.join(', ')}` });
  }
  const result = updateMatchingConfig(req.params.id, req.body);
  if (!result) return res.status(404).json({ error: `Module "${req.params.id}" not found` });
  res.json(result);
}));

// GET /api/admin/modules/:id/fields — list all fields (active + inactive) for a module
router.get('/modules/:id/fields', asyncHandler(async (req, res) => {
  const mod = getModule(req.params.id);
  if (!mod) return res.status(404).json({ error: `Module "${req.params.id}" not found` });
  const fields = mod.fields.map(f => ({
    name: f.name, label: f.label, type: f.type, group: f.group,
    active: f.active !== false, builtin: f.builtin !== false,
    required: !!f.required, unique: !!f.unique, searchable: !!f.searchable,
    filterable: !!f.filterable, trigram: !!f.trigram,
    ref_domain: f.ref_domain || null, ref_table: f.ref_table || null,
    max_length: f.max_length || null, pg_type: f.pg_type || null,
    list_display: !!f.list_display,
  }));
  res.json(fields);
}));

// PUT /api/admin/modules/:id/fields/:field — toggle field active state
router.put('/modules/:id/fields/:field', asyncHandler(async (req, res) => {
  const { id, field } = req.params;
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active (boolean) is required' });
  }
  const result = setFieldActive(id, field, active);
  if (!result) return res.status(404).json({ error: `Field "${field}" not found in module "${id}"` });
  res.json({ name: result.name, label: result.label, active: result.active });
}));

// POST /api/admin/modules/:id/fields — add a custom field
router.post('/modules/:id/fields', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, label, type, group, max_length } = req.body;
  if (!name || !label || !type || !group) {
    return res.status(400).json({ error: 'name, label, type, and group are required' });
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return res.status(400).json({ error: 'name must be lowercase snake_case starting with a letter' });
  }
  const field = addCustomField(id, { name, label, type, group, max_length, active: true, builtin: false });
  if (!field) return res.status(409).json({ error: `Field "${name}" already exists or module not found` });
  res.status(201).json(field);
}));

// DELETE /api/admin/modules/:id/fields/:field — delete a custom field (builtin fields cannot be deleted)
router.delete('/modules/:id/fields/:field', asyncHandler(async (req, res) => {
  const { id, field } = req.params;
  const deleted = deleteCustomField(id, field);
  if (!deleted) return res.status(400).json({ error: `Field "${field}" not found or is a builtin field (cannot delete)` });
  res.json({ success: true, deleted: field });
}));

// GET /api/admin/functions — list all mdm.fn_* validation functions
router.get('/functions', asyncHandler(async (_req, res) => {
  const result = await pool.query(`
    SELECT p.proname AS name,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS return_type,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'mdm' AND p.proname LIKE 'fn_%'
    ORDER BY p.proname
  `);
  res.json(result.rows.map(r => ({
    name: r.name,
    args: r.args,
    return_type: r.return_type,
    definition: r.definition,
  })));
}));

// Editable validation functions are the ones owned by mdm_fn_owner (migration 011);
// trigger and SECURITY DEFINER functions stay with the database owner and are read-only here.
async function isEditableFunction(name: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'mdm' AND p.proname = $1 AND pg_get_userbyid(p.proowner) = 'mdm_fn_owner'`, [name]);
  return r.rows.length > 0;
}

// PUT /api/admin/functions/:name — create or update a validation function
router.put('/functions/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  if (!/^fn_validate_[a-z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: 'Only mdm.fn_validate_* functions can be edited' });
  }
  const exists = await pool.query(
    `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'mdm' AND p.proname = $1`, [name]);
  if (exists.rows.length && !(await isEditableFunction(name))) {
    return res.status(403).json({ error: `mdm.${name} is a system function and cannot be edited here` });
  }
  const ddl = validateFunctionDdl(req.body?.definition, name);
  // Run as mdm_fn_owner so the DDL cannot touch anything the owner role could
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE mdm_fn_owner');
    await client.query(ddl);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(400).json({ error: `Failed to update function: ${(e as Error).message}` });
  } finally {
    client.release();
  }
  const updated = await pool.query(`
    SELECT p.proname AS name,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS return_type,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'mdm' AND p.proname = $1
  `, [name]);
  if (updated.rows.length === 0) {
    return res.status(404).json({ error: `Function mdm.${name} not found after update` });
  }
  res.json(updated.rows[0]);
}));

// GET /api/admin/schema — full ERD metadata: tables, columns, foreign keys
router.get('/schema', asyncHandler(async (_req, res) => {
  const [tables, columns, fks] = await Promise.all([
    pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'mdm' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `),
    pool.query(`
      SELECT c.table_name, c.column_name, c.data_type, c.ordinal_position,
             c.is_nullable, c.character_maximum_length,
             CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'mdm'
      ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
      WHERE c.table_schema = 'mdm'
      ORDER BY c.table_name, c.ordinal_position
    `),
    pool.query(`
      SELECT
        tc.constraint_name,
        kcu.table_name AS from_table,
        kcu.column_name AS from_column,
        ccu.table_name AS to_table,
        ccu.column_name AS to_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'mdm'
      ORDER BY kcu.table_name, kcu.column_name
    `),
  ]);

  const tableMap: Record<string, { columns: any[]; row_count?: number }> = {};
  for (const t of tables.rows) {
    tableMap[t.table_name] = { columns: [] };
  }
  for (const c of columns.rows) {
    if (tableMap[c.table_name]) {
      tableMap[c.table_name].columns.push({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        max_length: c.character_maximum_length,
        is_pk: c.is_pk,
      });
    }
  }

  res.json({
    tables: Object.entries(tableMap).map(([name, data]) => ({
      name, columns: data.columns,
    })),
    foreign_keys: fks.rows.map(fk => ({
      name: fk.constraint_name,
      from_table: fk.from_table, from_column: fk.from_column,
      to_table: fk.to_table, to_column: fk.to_column,
    })),
  });
}));

// ── MDM Roles CRUD ───────────────────────────────────────────────────────────

// GET /api/admin/roles — list all MDM roles
router.get('/roles', asyncHandler(async (_req, res) => {
  const result = await pool.query('SELECT * FROM mdm.ref_mdm_role ORDER BY sort_order');
  res.json(result.rows);
}));

// POST /api/admin/roles — add a role
router.post('/roles', asyncHandler(async (req, res) => {
  const { role_code, role_label, description, sort_order } = req.body;
  if (!role_code || !role_label) return res.status(400).json({ error: 'role_code and role_label are required' });
  const result = await pool.query(
    'INSERT INTO mdm.ref_mdm_role (role_code, role_label, description, sort_order, is_system) VALUES ($1, $2, $3, $4, false) RETURNING *',
    [role_code.toUpperCase().replace(/[^A-Z0-9_]/g, ''), role_label, description || null, sort_order ?? 99]
  );
  res.status(201).json(result.rows[0]);
}));

// PUT /api/admin/roles/:code — update a role
router.put('/roles/:code', asyncHandler(async (req, res) => {
  const { role_label, description, sort_order } = req.body;
  const sets: string[] = [];
  const vals: unknown[] = [req.params.code.toUpperCase()];
  let idx = 2;
  if (role_label !== undefined) { sets.push(`role_label = $${idx++}`); vals.push(role_label); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
  if (sort_order !== undefined) { sets.push(`sort_order = $${idx++}`); vals.push(sort_order); }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const result = await pool.query(`UPDATE mdm.ref_mdm_role SET ${sets.join(', ')} WHERE role_code = $1 RETURNING *`, vals);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  res.json(result.rows[0]);
}));

// DELETE /api/admin/roles/:code — delete a custom role (system roles cannot be deleted)
router.delete('/roles/:code', asyncHandler(async (req, res) => {
  const code = req.params.code.toUpperCase();
  const existing = await pool.query('SELECT is_system FROM mdm.ref_mdm_role WHERE role_code = $1', [code]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  if (existing.rows[0].is_system) return res.status(400).json({ error: 'Cannot delete system role' });
  await pool.query('DELETE FROM mdm.ref_mdm_role WHERE role_code = $1', [code]);
  res.json({ deleted: true, role_code: code });
}));

// ── Lifecycle stages & transitions CRUD ─────────────────────────────────────

// GET /api/admin/lifecycle/:entityType — stages + transitions for an entity
router.get('/lifecycle/:entityType', asyncHandler(async (req, res) => {
  const et = req.params.entityType.toUpperCase();
  const [stages, transitions] = await Promise.all([
    pool.query('SELECT * FROM mdm.ref_lifecycle_stage WHERE entity_type = $1 ORDER BY sort_order', [et]),
    pool.query('SELECT * FROM mdm.ref_lifecycle_transition WHERE entity_type = $1 ORDER BY id', [et]),
  ]);
  res.json({ stages: stages.rows, transitions: transitions.rows });
}));

// POST /api/admin/lifecycle/:entityType/stages — add a stage
router.post('/lifecycle/:entityType/stages', asyncHandler(async (req, res) => {
  const et = req.params.entityType.toUpperCase();
  const { stage_code, stage_label, sort_order, is_terminal, description } = req.body;
  if (!stage_code || !stage_label) return res.status(400).json({ error: 'stage_code and stage_label are required' });
  const result = await pool.query(
    'INSERT INTO mdm.ref_lifecycle_stage (entity_type, stage_code, stage_label, sort_order, is_terminal, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [et, stage_code.toUpperCase(), stage_label, sort_order ?? 99, is_terminal ?? false, description || null]
  );
  res.status(201).json(result.rows[0]);
}));

// PUT /api/admin/lifecycle/:entityType/stages/:id — update a stage
router.put('/lifecycle/:entityType/stages/:id', asyncHandler(async (req, res) => {
  const { stage_label, sort_order, is_terminal, description } = req.body;
  const sets: string[] = [];
  const vals: unknown[] = [req.params.id];
  let idx = 2;
  if (stage_label !== undefined) { sets.push(`stage_label = $${idx++}`); vals.push(stage_label); }
  if (sort_order !== undefined) { sets.push(`sort_order = $${idx++}`); vals.push(sort_order); }
  if (is_terminal !== undefined) { sets.push(`is_terminal = $${idx++}`); vals.push(is_terminal); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description || null); }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const result = await pool.query(`UPDATE mdm.ref_lifecycle_stage SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Stage not found' });
  res.json(result.rows[0]);
}));

// DELETE /api/admin/lifecycle/:entityType/stages/:id — delete a stage
router.delete('/lifecycle/:entityType/stages/:id', asyncHandler(async (req, res) => {
  // Remove related transitions first
  const stage = await pool.query('SELECT stage_code, entity_type FROM mdm.ref_lifecycle_stage WHERE id = $1', [req.params.id]);
  if (stage.rows.length === 0) return res.status(404).json({ error: 'Stage not found' });
  const { stage_code, entity_type } = stage.rows[0];
  await pool.query('DELETE FROM mdm.ref_lifecycle_transition WHERE entity_type = $1 AND (from_stage_code = $2 OR to_stage_code = $2)', [entity_type, stage_code]);
  await pool.query('DELETE FROM mdm.ref_lifecycle_stage WHERE id = $1', [req.params.id]);
  res.json({ deleted: true, stage_code });
}));

// POST /api/admin/lifecycle/:entityType/transitions — add a transition
router.post('/lifecycle/:entityType/transitions', asyncHandler(async (req, res) => {
  const et = req.params.entityType.toUpperCase();
  const { from_stage_code, to_stage_code, required_role } = req.body;
  if (!from_stage_code || !to_stage_code) return res.status(400).json({ error: 'from_stage_code and to_stage_code are required' });
  const result = await pool.query(
    'INSERT INTO mdm.ref_lifecycle_transition (entity_type, from_stage_code, to_stage_code, required_role) VALUES ($1, $2, $3, $4) RETURNING *',
    [et, from_stage_code.toUpperCase(), to_stage_code.toUpperCase(), required_role || null]
  );
  res.status(201).json(result.rows[0]);
}));

// PUT /api/admin/lifecycle/:entityType/transitions/:id — update a transition (e.g. required_role)
router.put('/lifecycle/:entityType/transitions/:id', asyncHandler(async (req, res) => {
  const { required_role } = req.body;
  const result = await pool.query(
    'UPDATE mdm.ref_lifecycle_transition SET required_role = $1 WHERE id = $2 RETURNING *',
    [required_role || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Transition not found' });
  res.json(result.rows[0]);
}));

// DELETE /api/admin/lifecycle/:entityType/transitions/:id — delete a transition
router.delete('/lifecycle/:entityType/transitions/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM mdm.ref_lifecycle_transition WHERE id = $1 RETURNING *', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Transition not found' });
  res.json({ deleted: true });
}));

// ────────── Localization ──────────

// GET /api/admin/branding — name, logo, palette and backgrounds
router.get('/branding', asyncHandler(async (_req, res) => {
  res.json({ branding: getBranding(), defaults: DEFAULT_BRANDING });
}));

// PUT /api/admin/branding — partial update, validated (colors #RRGGBB, logo https or PNG/SVG data URI)
router.put('/branding', asyncHandler(async (req, res) => {
  let next;
  try { next = validateBranding(req.body || {}); }
  catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  res.json({ branding: await setBranding(next) });
}));

// POST /api/admin/branding/reset — back to the Snowflake defaults
router.post('/branding/reset', asyncHandler(async (_req, res) => {
  res.json({ branding: await setBranding(structuredClone(DEFAULT_BRANDING)) });
}));

// GET /api/admin/localization — languages + operating countries
router.get('/localization', asyncHandler(async (_req, res) => {
  res.json({ languages: getLanguages(), countries: getCountries() });
}));

// POST /api/admin/localization/languages — add a translation language
router.post('/localization/languages', asyncHandler(async (req, res) => {
  const { code, label, default: isDefault } = req.body;
  if (!code || !label) return res.status(400).json({ error: 'code and label are required' });
  const lang = addLanguage(String(code), String(label), !!isDefault);
  if (!lang) return res.status(409).json({ error: `Language "${code}" already exists or is invalid` });
  res.status(201).json(lang);
}));

// PUT /api/admin/localization/languages/:code/default — make this the default language
router.put('/localization/languages/:code/default', asyncHandler(async (req, res) => {
  const lang = setDefaultLanguage(req.params.code);
  if (!lang) return res.status(404).json({ error: `Language "${req.params.code}" not found` });
  res.json({ languages: getLanguages() });
}));

// PUT /api/admin/localization/languages/:code/enabled — activate / deactivate
// The default language is the primary content language, so it can't be deactivated.
router.put('/localization/languages/:code/enabled', asyncHandler(async (req, res) => {
  const enabled = !!req.body.enabled;
  const code = req.params.code.trim().toLowerCase();
  const lang = getLanguages().find(l => l.code.toLowerCase() === code);
  if (!lang) return res.status(404).json({ error: `Language "${req.params.code}" not found` });
  if (!enabled && lang.default) {
    return res.status(409).json({ error: `"${lang.label}" is the default language. Set another language as default before deactivating it.` });
  }
  setLanguageEnabled(code, enabled);
  res.json({ languages: getLanguages() });
}));

// POST /api/admin/localization/countries — add an operating country
router.post('/localization/countries', asyncHandler(async (req, res) => {
  const { code, label } = req.body;
  if (!code || !label) return res.status(400).json({ error: 'code and label are required' });
  const country = addCountry(String(code), String(label));
  if (!country) return res.status(409).json({ error: `Country "${code}" already exists or is invalid` });
  res.status(201).json(country);
}));

// PUT /api/admin/localization/countries/:code/enabled — activate / deactivate
// Deactivating is refused while a user still has the country in their row-access
// scope, so it can't silently strip a user's visible data.
router.put('/localization/countries/:code/enabled', asyncHandler(async (req, res) => {
  const enabled = !!req.body.enabled;
  const code = req.params.code.trim().toUpperCase();
  const country = getCountries().find(c => c.code.toUpperCase() === code);
  if (!country) return res.status(404).json({ error: `Country "${req.params.code}" not found` });
  if (!enabled) {
    // Scopes live in mdm.app_user (the source the API and RLS actually use)
    const inUse = (await pool.query(
      `SELECT display_name FROM mdm.app_user WHERE is_active AND $1 = ANY(country_scope) ORDER BY display_name`, [code]
    )).rows as { display_name: string }[];
    if (inUse.length > 0) {
      return res.status(409).json({
        error: `"${country.label}" is in the country scope of ${inUse.length} user(s): ${inUse.map(u => u.display_name).join(', ')}. Clear it from their scope first.`,
      });
    }
  }
  setCountryEnabled(code, enabled);
  res.json({ countries: getCountries() });
}));

// ── PII masking (see src/pii.ts) ──
// The config is the source of truth. Saving rewrites GOVERNANCE.PII_UNMASK_ROLES (read by the
// masking policy at query time) and the PII_TYPE tags on the entity views (via the owner's-rights
// procedure GOVERNANCE.SET_PII_COLUMNS). The API masks the same fields for the same users.
const SF_ROLE_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,254}$/;

async function syncUnmaskRoles(roles: string[], actor: string) {
  const table = `${sfObjects().database}.GOVERNANCE.PII_UNMASK_ROLES`;
  await sfQuery(`DELETE FROM ${table}`);
  if (roles.length) {
    await sfQuery(`INSERT INTO ${table} (role_name, synced_by) SELECT column1, ? FROM VALUES ${roles.map(() => '(?)').join(', ')}`,
      undefined, [actor, ...roles]);
  }
}

async function syncPiiTags(fields: Record<string, string[]>) {
  for (const m of getModules()) {
    await sfQuery(`CALL ${sfObjects().database}.GOVERNANCE.SET_PII_COLUMNS(?, PARSE_JSON(?))`,
      undefined, [m.id.toUpperCase(), JSON.stringify(fields[m.id] ?? [])]);
  }
}

async function syncAll(actor: string) {
  resetPiiCache();
  await syncUnmaskRoles(unmaskRoles(), actor);
  await syncPiiTags(piiFields());
}

// GET /api/admin/governance/pii — unmask roles, PII fields per entity, and who sees what
router.get('/governance/pii', asyncHandler(async (_req, res) => {
  const configured = unmaskRoles();
  let snowflake: string[] | null = null; let available: string[] = []; let error: string | undefined;
  try {
    const rows = await sfQuery(`SELECT DISTINCT role_name FROM ${sfObjects().database}.GOVERNANCE.PII_UNMASK_ROLES ORDER BY role_name`);
    snowflake = rows.map(r => String(r.ROLE_NAME));
    available = (await sfQuery(`SHOW ROLES LIKE 'MDM%'`)).map(r => String(r.name)).sort();
  } catch (e: any) { error = e.message; }
  const inSync = snowflake !== null && [...configured].sort().join() === [...snowflake].sort().join();

  // Candidate fields: active text fields per module; selected: configured PII fields
  const entities = getModules().map(m => ({
    id: m.id, label: m.label,
    fields: m.fields.filter(f => f.active !== false && ['text', 'email', 'phone', 'string'].includes(f.type)).map(f => ({ name: f.name, label: f.label })),
    selected: piiFields()[m.id] ?? [],
  }));

  // Users: app role (Security › Users), Snowflake role, and the resulting masking
  const users = (await pool.query('SELECT email, display_name, role, sf_role FROM mdm.app_user WHERE is_active ORDER BY role, display_name')).rows;
  const withAccess = await Promise.all(users.map(async u => ({ ...u, pii_clear: await canSeePii(u.email) })));

  res.json({ roles: configured, snowflake_roles: snowflake, available, in_sync: inSync, error, entities, users: withAccess });
}));

// PUT /api/admin/governance/pii { roles?: string[], fields?: { [module]: string[] } } — save, then sync
router.put('/governance/pii', asyncHandler(async (req, res) => {
  const { roles, fields } = req.body ?? {};
  const cfg = loadConfig();
  const gov = { ...cfg.governance };
  if (roles !== undefined) {
    if (!Array.isArray(roles) || roles.some(r => typeof r !== 'string' || !SF_ROLE_RE.test(r))) {
      return res.status(400).json({ error: 'roles must be an array of Snowflake role names' });
    }
    gov.pii_unmask_roles = [...new Set(roles.map((r: string) => r.toUpperCase()))].sort();
  }
  if (fields !== undefined) {
    if (typeof fields !== 'object' || Array.isArray(fields)) return res.status(400).json({ error: 'fields must be { module: [field] }' });
    const next: Record<string, string[]> = {};
    for (const m of getModules()) {
      const want = fields[m.id] ?? piiFields()[m.id] ?? [];
      if (!Array.isArray(want)) return res.status(400).json({ error: `fields.${m.id} must be an array` });
      const known = new Set(m.fields.map(f => f.name));
      const bad = want.filter((f: unknown) => typeof f !== 'string' || !known.has(f));
      if (bad.length) return res.status(400).json({ error: `Unknown ${m.id} fields: ${bad.join(', ')}` });
      if (want.length) next[m.id] = [...new Set(want as string[])].sort();
    }
    gov.pii_fields = next;
  }
  cfg.governance = gov;
  saveConfig();
  try {
    await syncAll(req.headers['x-mdm-user'] as string);
    res.json({ roles: unmaskRoles(), fields: piiFields(), in_sync: true });
  } catch (e: any) {
    // Config is saved (API masking already follows it); Snowflake catches up on the next sync
    res.status(502).json({ roles: unmaskRoles(), fields: piiFields(), in_sync: false, error: `Saved, but Snowflake sync failed: ${e.message}` });
  }
}));

// POST /api/admin/governance/pii/sync — re-push roles and tags (e.g. after a Snowflake outage)
router.post('/governance/pii/sync', asyncHandler(async (req, res) => {
  try {
    await syncAll(req.headers['x-mdm-user'] as string);
    res.json({ roles: unmaskRoles(), in_sync: true });
  } catch (e: any) {
    res.status(502).json({ roles: unmaskRoles(), in_sync: false, error: e.message });
  }
}));

export default router;
