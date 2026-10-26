import { Router } from 'express';
import { userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { entityNameSql } from '../modules/entities.js';
import { visibleEntity } from '../scope.js';

const router = Router();

// GET /api/stewardship?user=email — personal stewardship dashboard (scoped to the caller's countries)
router.get('/', asyncHandler(async (req, res) => {
  const user = (req.query.user as string) || (req.headers['x-mdm-user'] as string) || '';
  const pool = userDb(req.headers['x-mdm-user'] as string);

  const [myWorkflows, allWorkflows, myAudit, allAudit, myMerges, dqFailing, recentActivity] = await Promise.all([
    // My open workflows
    pool.query(
      `SELECT wi.id, wi.entity_type, wi.entity_id, wi.workflow_type, wi.current_stage, wi.priority, wi.created_at, wi.notes,
              ${entityNameSql('wi.entity_type', 'wi.entity_id')} AS entity_name
       FROM mdm.workflow_instance wi
       WHERE wi.assigned_to = $1 AND wi.completed_at IS NULL AND ${visibleEntity('wi.entity_type', 'wi.entity_id')}
       ORDER BY CASE wi.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, wi.created_at DESC`,
      [user]
    ),
    // All open workflows (for comparison)
    pool.query(`SELECT COUNT(*)::int AS total FROM mdm.workflow_instance w WHERE w.completed_at IS NULL AND ${visibleEntity('w.entity_type', 'w.entity_id')}`),
    // My audit actions (last 30 days)
    pool.query(
      `SELECT action, COUNT(*)::int AS cnt FROM mdm.audit_log WHERE performed_by = $1 AND performed_at > NOW() - INTERVAL '30 days' GROUP BY action`,
      [user]
    ),
    // All audit actions (last 30 days, for comparison)
    pool.query(`SELECT COUNT(*)::int AS total FROM mdm.audit_log a WHERE a.performed_at > NOW() - INTERVAL '30 days' AND ${visibleEntity('a.entity_type', 'a.entity_id')}`),
    // My merges
    pool.query(
      `SELECT COUNT(*)::int AS total FROM mdm.merge_history WHERE merged_by = $1`,
      [user]
    ),
    // DQ failing entities (most recent run, worst first)
    pool.query(`
      SELECT DISTINCT ON (dr.entity_id) dr.entity_type, dr.entity_id,
             ${entityNameSql('dr.entity_type', 'dr.entity_id')} AS entity_name,
             r.rule_name, r.severity,
             ${entityNameSql('dr.entity_type', 'dr.entity_id', 'dq_score')} AS dq_score
      FROM mdm.dq_result dr
      JOIN mdm.dq_rule r ON r.id = dr.rule_id
      WHERE dr.passed = false AND ${visibleEntity('dr.entity_type', 'dr.entity_id')}
      ORDER BY dr.entity_id, r.severity DESC
      LIMIT 10
    `),
    // My recent activity timeline
    pool.query(
      `SELECT al.entity_type, al.action, al.changed_fields, al.performed_at,
              ${entityNameSql('al.entity_type', 'al.entity_id')} AS entity_name
       FROM mdm.audit_log al
       WHERE al.performed_by = $1 AND ${visibleEntity('al.entity_type', 'al.entity_id')}
       ORDER BY al.performed_at DESC
       LIMIT 10`,
      [user]
    ),
  ]);

  // KPIs
  const myUpdates = myAudit.rows.reduce((s: number, r: { cnt: number }) => s + r.cnt, 0);
  const myInserts = myAudit.rows.find((r: { action: string }) => r.action === 'INSERT')?.cnt || 0;

  res.json({
    user,
    kpis: {
      open_tasks: myWorkflows.rows.length,
      total_open_tasks: allWorkflows.rows[0].total,
      my_updates_30d: myUpdates,
      total_updates_30d: allAudit.rows[0].total,
      my_records_created: myInserts,
      my_merges: myMerges.rows[0].total,
      high_priority: myWorkflows.rows.filter((w: { priority: string }) => w.priority === 'HIGH').length,
    },
    my_workflows: myWorkflows.rows,
    dq_failures: dqFailing.rows,
    recent_activity: recentActivity.rows,
  });
}));

export default router;
