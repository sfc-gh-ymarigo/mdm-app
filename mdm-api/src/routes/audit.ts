import { Router } from 'express';
import { userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { entityNameSql } from '../modules/entities.js';
import { visibleEntity } from '../scope.js';
import { parsePaging, pagedSql, pagedResult } from '../lib/paging.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { entity_type, entity_id } = req.query;
  let sql = `
    SELECT a.*, 
      ${entityNameSql('a.entity_type', 'a.entity_id')} AS entity_name
    FROM mdm.audit_log a WHERE ${visibleEntity('a.entity_type', 'a.entity_id')}`;
  const params: unknown[] = [];
  let idx = 1;

  if (entity_type) { sql += ` AND a.entity_type = $${idx++}`; params.push(entity_type); }
  if (entity_id) { sql += ` AND a.entity_id = $${idx++}`; params.push(entity_id); }
  if (req.query.user) { sql += ` AND a.performed_by = $${idx++}`; params.push(String(req.query.user)); }
  if (req.query.action) { sql += ` AND a.action = $${idx++}`; params.push(String(req.query.action).toUpperCase()); }

  const p = parsePaging(req, {
    performed_at: 'a.performed_at', action: 'a.action', entity_type: 'a.entity_type', performed_by: 'a.performed_by',
  }, 'a.performed_at DESC, a.id DESC');
  if (p.q) {
    sql += ` AND (a.performed_by ILIKE $${idx} OR a.action ILIKE $${idx} OR a.entity_id::text ILIKE $${idx}
      OR ${entityNameSql('a.entity_type', 'a.entity_id')} ILIKE $${idx} OR a.changed_fields::text ILIKE $${idx})`;
    params.push(`%${p.q}%`); idx++;
  }
  const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  if (from) { sql += ` AND a.performed_at >= $${idx++}::date`; params.push(from); }
  if (to) { sql += ` AND a.performed_at < $${idx++}::date + 1`; params.push(to); }
  // Unpaged callers keep the historical 100-row cap
  sql = p.paged ? pagedSql(sql, p, params) : `${sql} ORDER BY ${p.orderBy} LIMIT 100`;
  const result = await userDb(req.headers['x-mdm-user'] as string).query(sql, params);
  res.json(pagedResult(result.rows, p));
}));

export default router;
