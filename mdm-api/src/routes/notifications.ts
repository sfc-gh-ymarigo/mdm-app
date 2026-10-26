// ============================================================
// Notifications — computed per user from live data (no fan-out table):
//   • open workflows assigned to me, or to one of my workflow roles and unassigned
//   • failing ERROR rules on records in my scope (stewards/admins)
//   • recent merges / unmerges by other users
//   • admins: open Snowflake-side findings (MDM_AI.ALERT_LOG, e.g. CDC mirror health)
// Read state is kept per user and notification key in mdm.notification_read.
// ============================================================
import { Router } from 'express';
import pool, { getAppUser, userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { visibleEntity } from '../scope.js';
import { entityNameSql } from '../modules/entities.js';
import { sfQuery, snowflakeConfigured } from '../snowflake.js';
import { sfObjects } from '../config.js';
import { logger } from '../logger.js';

const router = Router();

interface Notification {
  key: string;
  type: 'workflow' | 'dq' | 'merge' | 'ops';
  /** English fallback; the UI renders msg in the user's language */
  text: string;
  msg: { key: string; params: Record<string, unknown> };
  path: string;
  at: string;
  read: boolean;
}

const MAX = 30;

// Open ALERT_LOG findings, shared by all admins; cached so the bell does not hit Snowflake each poll.
// Snowflake being unreachable never breaks the bell.
let opsCache: { at: number; rows: Record<string, unknown>[] } | null = null;
async function openOpsAlerts(): Promise<Record<string, unknown>[]> {
  if (!snowflakeConfigured()) return [];
  if (opsCache && Date.now() - opsCache.at < 60_000) return opsCache.rows;
  try {
    const rows = await sfQuery(
      `SELECT id, alert_name, severity, message, raised_at FROM ${sfObjects().database}.MDM_AI.ALERT_LOG
        WHERE resolved_at IS NULL ORDER BY raised_at DESC LIMIT 10`);
    opsCache = { at: Date.now(), rows };
  } catch (err) {
    logger.warn({ err }, 'ALERT_LOG unavailable');
    opsCache = { at: Date.now(), rows: [] };
  }
  return opsCache.rows;
}

// GET /api/notifications
router.get('/', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const appUser = await getAppUser(user);
  const roles = appUser.mdm_roles || [];
  const isAdmin = roles.includes('MDM_ADMIN') || appUser.role === 'ADMIN';
  const db = userDb(user);

  const [wf, dq, merges, reads, ops] = await Promise.all([
    db.query(
      `SELECT w.id, w.workflow_type, w.current_stage, w.assigned_to, w.assigned_role, w.priority,
              COALESCE(w.updated_at, w.created_at) AS at, ${entityNameSql('w.entity_type', 'w.entity_id')} AS entity_name,
              (SELECT s.stage_label FROM mdm.ref_lifecycle_stage s
                WHERE s.entity_type = w.entity_type AND s.stage_code = w.current_stage LIMIT 1) AS stage_label
         FROM mdm.workflow_instance w
        WHERE w.completed_at IS NULL
          AND (w.assigned_to = $1 OR (w.assigned_to IS NULL AND (w.assigned_role = ANY($2::text[]) OR $3)))
          AND ${visibleEntity('w.entity_type', 'w.entity_id')}
        ORDER BY CASE w.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, at DESC
        LIMIT ${MAX}`,
      [user, roles, isAdmin]),
    appUser.role === 'VIEWER' ? Promise.resolve({ rows: [] }) : db.query(
      `SELECT r.id, r.rule_name, r.entity_type, count(*)::int AS failed, max(d.evaluated_at) AS at
         FROM mdm.dq_result d JOIN mdm.dq_rule r ON r.id = d.rule_id
        WHERE NOT d.passed AND r.is_active AND r.severity = 'ERROR'
          AND ${visibleEntity('d.entity_type', 'd.entity_id')}
        GROUP BY r.id, r.rule_name, r.entity_type
        ORDER BY failed DESC LIMIT 5`),
    db.query(
      `SELECT m.id, m.entity_type, ${entityNameSql('m.entity_type', 'm.survivor_id', 'golden_id')} AS golden_id, m.merged_by, m.unmerged_by, m.unmerged_at,
              COALESCE(m.unmerged_at, m.merged_at) AS at,
              ${entityNameSql('m.entity_type', 'm.survivor_id')} AS survivor_name,
              ${entityNameSql('m.entity_type', 'm.merged_id')} AS merged_name
         FROM mdm.merge_history m
        WHERE COALESCE(m.unmerged_at, m.merged_at) > now() - interval '7 days'
          AND COALESCE(m.unmerged_by, m.merged_by) <> $1
          AND ${visibleEntity('m.entity_type', 'm.survivor_id')}
        ORDER BY at DESC LIMIT 10`,
      [user]),
    pool.query('SELECT notif_key FROM mdm.notification_read WHERE user_email = $1', [user]),
    isAdmin ? openOpsAlerts() : Promise.resolve([]),
  ]);

  const read = new Set(reads.rows.map(r => r.notif_key as string));
  const items: Notification[] = [];
  for (const w of wf.rows) {
    // The key includes the stage so a workflow becomes unread again when it moves to a step that needs me
    const key = `wf:${w.id}:${w.current_stage}`;
    const toMe = w.assigned_to === user;
    const params = { type: w.workflow_type, name: w.entity_name ?? '', stage: w.stage_label ?? w.current_stage, stage_code: w.current_stage, role: w.assigned_role };
    items.push({ key, type: 'workflow', path: `/workflows/${w.id}`, at: w.at, read: read.has(key),
      msg: { key: toMe ? 'workflowToMe' : 'workflowToRole', params },
      text: `${w.workflow_type.replace(/_/g, ' ').toLowerCase()} · ${w.entity_name ?? 'record'} at ${params.stage} (assigned to ${toMe ? 'you' : `role ${w.assigned_role}`})` });
  }
  for (const r of dq.rows) {
    // Count in the key: new failures resurface the notification
    const key = `dq:${r.id}:${r.failed}`;
    items.push({ key, type: 'dq', path: `/data-quality/rules/${r.id}`, at: r.at, read: read.has(key),
      msg: { key: 'dqFailing', params: { count: r.failed, rule: r.rule_name } },
      text: `${r.failed} record${r.failed === 1 ? '' : 's'} fail "${r.rule_name}"` });
  }
  for (const m of merges.rows) {
    const key = `merge:${m.id}:${m.unmerged_at ? 'u' : 'm'}`;
    const params = { user: m.unmerged_at ? m.unmerged_by : m.merged_by, merged: m.merged_name ?? '', survivor: m.survivor_name ?? '' };
    items.push({ key, type: 'merge', path: `/golden/${encodeURIComponent(m.golden_id ?? '')}`, at: m.at, read: read.has(key),
      msg: { key: m.unmerged_at ? 'unmerged' : 'merged', params },
      text: m.unmerged_at
        ? `${m.unmerged_by} unmerged ${m.merged_name ?? 'a record'} from ${m.survivor_name ?? 'its survivor'}`
        : `${m.merged_by} merged ${m.merged_name ?? 'a record'} into ${m.survivor_name ?? 'a survivor'}` });
  }
  for (const o of ops) {
    const key = `ops:${o.ID}`;
    items.push({ key, type: 'ops', path: '/configuration/integrations/replication', read: read.has(key),
      at: o.RAISED_AT instanceof Date ? o.RAISED_AT.toISOString() : String(o.RAISED_AT),
      msg: { key: 'ops', params: { message: o.MESSAGE } },
      text: `Snowflake: ${o.MESSAGE}` });
  }
  items.sort((a, b) => Number(a.read) - Number(b.read) || new Date(b.at).getTime() - new Date(a.at).getTime());
  res.json({ items: items.slice(0, MAX), unread: items.filter(i => !i.read).length });
}));

// POST /api/notifications/read { keys: string[] }
router.post('/read', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.filter((k: unknown) => typeof k === 'string' && k.length <= 200).slice(0, 200) : [];
  if (!keys.length) { res.status(400).json({ error: 'keys must be a non-empty array of strings' }); return; }
  await pool.query(
    `INSERT INTO mdm.notification_read (user_email, notif_key)
     SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [user, keys]);
  res.json({ marked: keys.length });
}));

export default router;
