// ============================================================
// Record context — everything the record page shows next to the record itself
// ============================================================
import { Router } from 'express';
import { getAppUser, userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { entityInfo } from '../modules/entities.js';

const router = Router();

// GET /api/records/:module/:id/context — DQ results, workflows, comments, merges (RLS applies)
router.get('/:module/:id/context', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const ent = entityInfo(req.params.module);
  const db = userDb(user);
  const id = req.params.id;

  // Visible to the caller? (RLS on the entity table)
  const rec = await db.query(`SELECT id, golden_id FROM ${ent.table} WHERE id = $1`, [id]);
  if (!rec.rows.length) { res.status(404).json({ error: 'Not found' }); return; }

  const [dq, workflows, comments, merges] = await Promise.all([
    db.query(
      `SELECT r.id AS rule_id, r.rule_code, r.rule_name, r.severity, r.category, d.passed, d.evaluated_at
         FROM mdm.dq_result d JOIN mdm.dq_rule r ON r.id = d.rule_id
        WHERE d.entity_type = $1 AND d.entity_id = $2
        ORDER BY d.passed, CASE r.severity WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, r.rule_code`,
      [ent.type, id]),
    db.query(
      `SELECT w.id, w.workflow_type, w.current_stage, w.priority, w.assigned_to, w.created_by, w.created_at, w.completed_at,
              (SELECT count(*)::int FROM mdm.workflow_step_log s WHERE s.workflow_id = w.id) AS steps
         FROM mdm.workflow_instance w
        WHERE w.entity_type = $1 AND w.entity_id = $2
        ORDER BY w.completed_at IS NOT NULL, w.created_at DESC`,
      [ent.type, id]),
    db.query(
      `SELECT id, comment_text, created_by, created_at FROM mdm.entity_comment
        WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
      [ent.type, id]),
    db.query(
      `SELECT id, survivor_id, merged_id, merged_by, merged_at, unmerged_at
         FROM mdm.merge_history WHERE entity_type = $1 AND (survivor_id = $2 OR merged_id = $2)
        ORDER BY merged_at DESC`,
      [ent.type, id]),
  ]);

  res.json({
    entity_type: ent.type,
    golden_id: rec.rows[0].golden_id,
    dq: { failed: dq.rows.filter(r => !r.passed).length, total: dq.rows.length, results: dq.rows },
    workflows: workflows.rows,
    comments: comments.rows,
    merges: merges.rows,
  });
}));

// POST /api/records/:module/:id/comments { text }
router.post('/:module/:id/comments', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user);
  if (appUser.role === 'VIEWER') { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  const text = String(req.body?.text ?? '').trim();
  if (!text || text.length > 4000) { res.status(400).json({ error: 'Comment must be 1–4000 characters' }); return; }
  const ent = entityInfo(req.params.module);
  const db = userDb(user);
  const rec = await db.query(`SELECT 1 FROM ${ent.table} WHERE id = $1`, [req.params.id]);
  if (!rec.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  const r = await db.query(
    `INSERT INTO mdm.entity_comment (entity_type, entity_id, comment_text, created_by) VALUES ($1, $2, $3, $4)
     RETURNING id, comment_text, created_by, created_at`,
    [ent.type, req.params.id, text, user]);
  res.status(201).json(r.rows[0]);
}));

export default router;
