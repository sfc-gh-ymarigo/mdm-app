import { Router } from 'express';
import { getAppUser, userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { scopeClause, visibleEntity } from '../scope.js';
import { entityInfo, enabledEntities, type EntityInfo } from '../modules/entities.js';
import { parsePaging, pagedSql, pagedResult, wrap } from '../lib/paging.js';

const router = Router();

// Columns shown per source record in the golden list (when the module has them)
const SOURCE_EXTRAS = ['country_code', 'sku', 'tax_id'];

function activeFields(e: EntityInfo): Set<string> {
  return new Set(e.mod.fields.filter(f => f.active !== false).map(f => f.name));
}

// GET /api/golden — list all golden records with cross-references (one block per enabled module)
router.get('/', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  const params: unknown[] = [];

  const onlyType = typeof req.query.entity_type === 'string' ? req.query.entity_type.toUpperCase() : null;
  const blocks = enabledEntities().filter(e => !onlyType || e.type === onlyType).map(e => {
    const active = activeFields(e);
    const scope = e.hasCountry ? scopeClause(appUser, e.moduleId, 'country_code', params) : '';
    const extras = SOURCE_EXTRAS.filter(c => active.has(c)).map(c => `, '${c}', ${c}`).join('');
    return `
      SELECT golden_id, '${e.type}' AS entity_type,
             jsonb_agg(jsonb_build_object(
               'id', id, 'source_system', source_system, 'source_id', source_id,
               'name', ${e.nameCol}, 'is_deleted', is_deleted, 'dq_score', dq_score,
               'lifecycle_stage', lifecycle_stage${extras}
             ) ORDER BY is_deleted, updated_at DESC) AS sources,
             MAX(CASE WHEN NOT is_deleted THEN ${e.nameCol}::text END) AS golden_name,
             MAX(CASE WHEN NOT is_deleted THEN dq_score END) AS dq_score,
             MAX(CASE WHEN NOT is_deleted THEN lifecycle_stage END) AS lifecycle_stage,
             COUNT(*) FILTER (WHERE NOT is_deleted) AS active_count,
             COUNT(*) FILTER (WHERE is_deleted) AS merged_count
      FROM ${e.table} WHERE golden_id IS NOT NULL${scope ? ` AND ${scope}` : ''}
      GROUP BY golden_id`;
  });
  if (!blocks.length) { res.json([]); return; }

  const p = parsePaging(req, {
    golden_id: 'golden_id', entity_type: 'entity_type', golden_name: 'golden_name', dq_score: 'dq_score',
    lifecycle_stage: 'lifecycle_stage', active_count: 'active_count', merged_count: 'merged_count',
  }, 'golden_id');
  let sql = wrap(blocks.join('\n    UNION ALL'));
  const where: string[] = [];
  if (p.q) { params.push(`%${p.q}%`); where.push(`(golden_name ILIKE $${params.length} OR golden_id::text ILIKE $${params.length})`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  const result = await userDb(user).query(pagedSql(sql, p, params), params);
  res.json(pagedResult(result.rows, p));
}));

// GET /api/golden/:id — full golden record detail with cross-refs, merge history, and lineage
router.get('/:id', asyncHandler(async (req, res) => {
  const goldenId = req.params.id;
  const user = req.headers['x-mdm-user'] as string;
  // All lookups run under the caller's identity: RLS hides golden records outside their scope.
  const db = userDb(user);

  let ent: EntityInfo | null = null;
  for (const e of enabledEntities()) {
    if ((await db.query(`SELECT 1 FROM ${e.table} WHERE golden_id = $1 LIMIT 1`, [goldenId])).rows.length) { ent = e; break; }
  }
  if (!ent) { res.status(404).json({ error: 'Golden ID not found' }); return; }

  // All records tied to this golden_id (survivor + merged)
  const records = await db.query(`SELECT * FROM ${ent.table} WHERE golden_id = $1 ORDER BY is_deleted, updated_at DESC`, [goldenId]);
  const ids = records.rows.map((r: { id: string }) => r.id);
  const survivor = records.rows.find((r: { is_deleted: boolean }) => !r.is_deleted);
  const merged = records.rows.filter((r: { is_deleted: boolean }) => r.is_deleted);

  const xrefs = records.rows.map((r: { id: string; source_system: string; source_id: string; is_deleted: boolean }) => ({
    id: r.id,
    source_system: r.source_system,
    source_id: r.source_id,
    is_survivor: !r.is_deleted,
  }));

  const mergeHistory = await db.query(
    `SELECT mh.id, mh.entity_type, mh.survivor_id, mh.merged_id, mh.survivorship, mh.merged_by, mh.merged_at,
            mh.unmerged_at, mh.unmerged_by, s.${ent.nameCol} AS survivor_name, m.${ent.nameCol} AS merged_name
     FROM mdm.merge_history mh
     LEFT JOIN ${ent.table} s ON s.id = mh.survivor_id
     LEFT JOIN ${ent.table} m ON m.id = mh.merged_id
     WHERE mh.entity_type = $2 AND (mh.survivor_id = ANY($1) OR mh.merged_id = ANY($1))
     ORDER BY mh.merged_at DESC`,
    [ids, ent.type]
  );

  const auditTrail = await db.query(
    `SELECT * FROM mdm.audit_log a WHERE a.entity_id = ANY($1) AND ${visibleEntity('a.entity_type', 'a.entity_id')} ORDER BY a.performed_at DESC LIMIT 50`,
    [ids]
  );

  res.json({
    golden_id: goldenId,
    entity_type: ent.type,
    survivor,
    merged,
    xrefs,
    merge_history: mergeHistory.rows,
    audit_trail: auditTrail.rows,
  });
}));

// POST /api/golden/bulk-stage — bulk lifecycle change
router.post('/bulk-stage', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user || 'anonymous');
  if (appUser.role === 'VIEWER') { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const { entity_type, ids, stage } = req.body;
  if (!entity_type || !ids?.length || !stage) {
    res.status(400).json({ error: 'entity_type, ids, and stage are required' });
    return;
  }
  const { table } = entityInfo(entity_type);
  // RLS: rows outside the caller's scope are silently skipped (not counted in `updated`).
  const result = await userDb(user).query(
    `UPDATE ${table} SET lifecycle_stage = $1, updated_by = $2 WHERE id = ANY($3) AND is_deleted = false RETURNING id`,
    [stage, user, ids]
  );
  res.json({ updated: result.rowCount });
}));

export default router;
