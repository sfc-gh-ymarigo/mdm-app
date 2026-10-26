import { Router } from 'express';
import pool, { getAppUser, withUser, userDb } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { visibleEntity } from '../scope.js';
import { parsePaging, pagedSql, pagedResult } from '../lib/paging.js';
import { entityInfo, entityNameSql, HttpError } from '../modules/entities.js';

const router = Router();

// Is the workflow's entity visible to this user? (RLS-filtered lookup)
async function workflowInScope(user: string, workflowId: string): Promise<boolean> {
  const r = await userDb(user).query(
    `SELECT ${visibleEntity('w.entity_type', 'w.entity_id')} AS ok FROM mdm.workflow_instance w WHERE w.id = $1`, [workflowId]);
  return !!r.rows[0]?.ok;
}

interface Transition {
  from_stage_code: string;
  to_stage_code: string;
  required_role: string | null;
  entity_stage: string | null;
  workflow_type: string | null;
}

/** Transitions for a workflow: its own rows, or the generic lifecycle rows when it has none. */
async function workflowTransitions(entityType: string, workflowType: string): Promise<Transition[]> {
  const r = await pool.query(
    `SELECT t.from_stage_code, t.to_stage_code, t.required_role, t.entity_stage, t.workflow_type
       FROM mdm.ref_lifecycle_transition t
      WHERE t.entity_type = $1 AND t.to_stage_code IS NOT NULL
        AND (t.workflow_type = $2 OR (t.workflow_type IS NULL AND NOT EXISTS (
              SELECT 1 FROM mdm.ref_lifecycle_transition x WHERE x.entity_type = $1 AND x.workflow_type = $2)))
      ORDER BY t.from_stage_code, t.to_stage_code`,
    [entityType, workflowType]);
  return r.rows;
}

async function stageOrder(entityType: string): Promise<Map<string, { order: number; terminal: boolean }>> {
  const r = await pool.query('SELECT stage_code, sort_order, is_terminal FROM mdm.ref_lifecycle_stage WHERE entity_type = $1', [entityType]);
  return new Map(r.rows.map((x: { stage_code: string; sort_order: number; is_terminal: boolean }) =>
    [x.stage_code, { order: x.sort_order, terminal: x.is_terminal }]));
}

/** Forward transitions out of `stage` (generic rows exclude moves back down the lifecycle). */
function forwardFrom(stage: string, all: Transition[], stages: Map<string, { order: number }>): Transition[] {
  return all.filter(t => t.from_stage_code === stage && t.to_stage_code !== stage && (
    t.workflow_type !== null || (stages.get(t.to_stage_code)?.order ?? 0) > (stages.get(stage)?.order ?? 0)));
}

function hasRole(appUser: { mdm_roles?: string[] }, role: string | null): boolean {
  if (!role) return true;
  const roles = appUser.mdm_roles || [];
  return roles.includes('MDM_ADMIN') || roles.includes(role);
}

const asOptions = (ts: Transition[]) => ts.map(t => ({ to_stage: t.to_stage_code, required_role: t.required_role }));

router.get('/', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const p = parsePaging(req, {
    id: 'w.id', entity_name: entityNameSql('w.entity_type', 'w.entity_id'), entity_type: 'w.entity_type', workflow_type: 'w.workflow_type', current_stage: 'w.current_stage',
    assigned_to: 'w.assigned_to', assigned_role: 'w.assigned_role', due_date: 'w.due_date', created_at: 'w.created_at',
    priority: "CASE w.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END",
  }, "CASE w.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, w.created_at, w.id");
  const result = await withUser(user, async (client) => {
    // Only workflows whose entity is visible to the caller (Postgres RLS on entity tables)
    const params: unknown[] = [];
    let sql = `
      SELECT w.*, ${entityNameSql('w.entity_type', 'w.entity_id')} AS entity_name
      FROM mdm.workflow_instance w
      WHERE w.completed_at IS NULL AND ${visibleEntity('w.entity_type', 'w.entity_id')}`;
    for (const f of ['entity_type', 'workflow_type', 'current_stage', 'assigned_to', 'assigned_role', 'priority']) {
      const v = req.query[f];
      if (typeof v === 'string' && v) { params.push(v); sql += ` AND w.${f} = $${params.length}`; }
    }
    if (p.q) {
      params.push(`%${p.q}%`);
      sql += ` AND (${entityNameSql('w.entity_type', 'w.entity_id')} ILIKE $${params.length} OR w.notes ILIKE $${params.length}
        OR w.workflow_type ILIKE $${params.length} OR w.current_stage ILIKE $${params.length} OR w.assigned_to ILIKE $${params.length}
        OR w.priority ILIKE $${params.length} OR w.id::text = $${params.length + 1})`;
      params.push(p.q);
    }
    return client.query(pagedSql(sql, p, params), params);
  });

  // Possible next stages, so the UI can offer a choice when there are several
  const cache = new Map<string, { all: Transition[]; stages: Map<string, { order: number; terminal: boolean }> }>();
  for (const w of result.rows) {
    const key = `${w.entity_type}|${w.workflow_type}`;
    if (!cache.has(key)) cache.set(key, { all: await workflowTransitions(w.entity_type, w.workflow_type), stages: await stageOrder(w.entity_type) });
    const { all, stages } = cache.get(key)!;
    w.available_transitions = asOptions(forwardFrom(w.current_stage, all, stages));
  }
  res.json(pagedResult(result.rows, p));
}));

// GET /api/workflows/counts — open workflows per entity type and workflow type (tab badges, type cards)
router.get('/counts', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const r = await userDb(user).query(`
    SELECT w.entity_type, w.workflow_type, COUNT(*)::int AS count
      FROM mdm.workflow_instance w
     WHERE w.completed_at IS NULL AND ${visibleEntity('w.entity_type', 'w.entity_id')}
     GROUP BY 1, 2`);
  res.json(r.rows);
}));

// GET /api/workflows/:id — one workflow (open or completed) with its step log and next transitions
router.get('/:id', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  if (!/^\d+$/.test(req.params.id)) { res.status(400).json({ error: 'Invalid workflow id' }); return; }
  if (!(await workflowInScope(user, req.params.id))) { res.status(404).json({ error: 'Not found' }); return; }
  const w = (await userDb(user).query(
    `SELECT w.*, ${entityNameSql('w.entity_type', 'w.entity_id')} AS entity_name FROM mdm.workflow_instance w WHERE w.id = $1`,
    [req.params.id])).rows[0];
  if (!w) { res.status(404).json({ error: 'Not found' }); return; }
  const steps = await pool.query(
    'SELECT from_stage, to_stage, action, performed_by, comment, performed_at FROM mdm.workflow_step_log WHERE workflow_id = $1 ORDER BY performed_at',
    [req.params.id]);
  if (!w.completed_at) {
    const all = await workflowTransitions(w.entity_type, w.workflow_type);
    w.available_transitions = asOptions(forwardFrom(w.current_stage, all, await stageOrder(w.entity_type)));
  } else w.available_transitions = [];
  res.json({ ...w, steps: steps.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string || 'system';
  const { entity_id, workflow_type, priority, assigned_to } = req.body;
  if (!req.body.entity_type || !entity_id || !workflow_type) {
    res.status(400).json({ error: 'Missing required fields: entity_type, entity_id, workflow_type' });
    return;
  }
  const ent = entityInfo(req.body.entity_type);
  const entity_type = ent.type;
  const visible = await userDb(user).query(`SELECT lifecycle_stage FROM ${ent.table} WHERE id = $1`, [entity_id]);
  if (!visible.rows.length) { res.status(403).json({ error: 'This entity is outside your country scope' }); return; }
  // Check no open workflow of same type exists for this entity
  const existing = await pool.query(
    'SELECT id FROM mdm.workflow_instance WHERE entity_id = $1 AND entity_type = $2 AND workflow_type = $3 AND completed_at IS NULL',
    [entity_id, entity_type, workflow_type]
  );
  if (existing.rows.length > 0) {
    res.status(409).json({ error: `An open ${workflow_type} workflow already exists for this entity` });
    return;
  }
  const result = await pool.query(
    `INSERT INTO mdm.workflow_instance (entity_type, entity_id, workflow_type, current_stage, priority, assigned_to, created_by, payload)
     VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7) RETURNING *`,
    [entity_type, entity_id, workflow_type, priority || 'MEDIUM', assigned_to || user, user,
     JSON.stringify({ entity_stage_at_start: visible.rows[0].lifecycle_stage })]
  );
  res.status(201).json(result.rows[0]);
}));

// POST /api/workflows/:id/advance  { action: 'APPROVE' | 'REJECT', to_stage?, comment? }
router.post('/:id/advance', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const { action = 'APPROVE', comment, to_stage } = req.body;
  if (!['APPROVE', 'REJECT'].includes(action)) { res.status(400).json({ error: 'action must be APPROVE or REJECT' }); return; }
  const appUser = await getAppUser(user);
  const wf = await pool.query('SELECT * FROM mdm.workflow_instance WHERE id = $1', [req.params.id]);
  if (wf.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  const current = wf.rows[0];

  // Country scope first (RLS decides visibility), so out-of-scope callers learn nothing else
  if (!(await workflowInScope(user, req.params.id))) {
    res.status(403).json({ error: 'This entity is outside your country scope' });
    return;
  }
  if (current.completed_at) { res.status(409).json({ error: 'Workflow already completed', stage: current.current_stage }); return; }

  const ent = entityInfo(current.entity_type, { includeDisabled: true });
  const all = await workflowTransitions(current.entity_type, current.workflow_type);
  const stages = await stageOrder(current.entity_type);
  const forward = forwardFrom(current.current_stage, all, stages);
  const payload = (typeof current.payload === 'string' ? JSON.parse(current.payload) : current.payload) || {};

  let nextStage: string;
  let terminal: boolean;
  let entityStage: string | null = null;
  let requiredRole: string | null;

  if (action === 'REJECT') {
    // Rejecting needs a role that could have approved the current step
    requiredRole = forward[0]?.required_role ?? null;
    if (forward.length && !forward.some(t => hasRole(appUser, t.required_role))) {
      res.status(403).json({ error: `Role "${requiredRole}" is required to reject at this stage`, required_role: requiredRole, your_roles: appUser.mdm_roles || [] });
      return;
    }
    nextStage = 'REJECTED';
    terminal = true;
    // Entity goes back to where it was when the workflow started (unchanged if unknown)
    const start = payload.entity_stage_at_start;
    entityStage = typeof start === 'string' && stages.has(start) ? start : null;
  } else {
    let chosen: Transition | undefined;
    if (to_stage) {
      chosen = all.find(t => t.from_stage_code === current.current_stage && t.to_stage_code === to_stage);
      if (!chosen) { res.status(400).json({ error: `No transition from ${current.current_stage} to ${to_stage}`, available_transitions: asOptions(forward) }); return; }
    } else if (forward.length === 1) {
      chosen = forward[0];
    } else if (forward.length === 0) {
      res.status(409).json({ error: `No transition out of stage ${current.current_stage}` });
      return;
    } else {
      res.status(400).json({ error: 'Several transitions are possible: choose one with to_stage', available_transitions: asOptions(forward) });
      return;
    }
    requiredRole = chosen.required_role;
    if (!hasRole(appUser, requiredRole)) {
      res.status(403).json({ error: `Role "${requiredRole}" is required for this transition`, required_role: requiredRole, your_roles: appUser.mdm_roles || [] });
      return;
    }
    nextStage = chosen.to_stage_code;
    terminal = forwardFrom(nextStage, all, stages).length === 0 || stages.get(nextStage)?.terminal === true;
    // Workflow-specific rows say which entity stage to set; generic rows move the entity along
    const target = chosen.workflow_type !== null ? chosen.entity_stage : (chosen.entity_stage ?? chosen.to_stage_code);
    entityStage = target && stages.has(target) ? target : null;
  }

  // Single transaction on the caller's connection: entity updates go through RLS.
  await withUser(user, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO mdm.workflow_step_log (workflow_id, from_stage, to_stage, action, performed_by, comment) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.params.id, current.current_stage, nextStage, action, user, comment]
      );
      await client.query(
        `UPDATE mdm.workflow_instance SET current_stage = $2, updated_at = NOW()${terminal ? ', completed_at = NOW()' : ''} WHERE id = $1`,
        [req.params.id, nextStage]
      );
      if (entityStage) {
        await client.query(
          `UPDATE ${ent.table} SET lifecycle_stage = $2, updated_by = $3 WHERE id = $1`,
          [current.entity_id, entityStage, user]
        );
      }
      // Apply the requested parent change on final approval
      if (current.workflow_type === 'HIERARCHY_CHANGE' && terminal && action === 'APPROVE' && payload.field) {
        const field = String(payload.field);
        if (!/^[a-z_][a-z0-9_]*$/.test(field) || !ent.mod.fields.some(f => f.name === field) || field !== ent.mod.hierarchy?.parent_field) {
          throw new HttpError(400, `Invalid hierarchy field: ${field}`);
        }
        await client.query(
          `UPDATE ${ent.table} SET ${field} = $2, updated_by = $3 WHERE id = $1`,
          [current.entity_id, payload.new_value, user]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });

  const next = terminal ? [] : forwardFrom(nextStage, all, stages);
  res.json({
    advanced: true,
    from_stage: current.current_stage,
    new_stage: nextStage,
    terminal,
    entity_stage: entityStage,
    required_role: requiredRole,
    next_required_role: next[0]?.required_role ?? null,
    available_transitions: asOptions(next),
  });
}));

// POST /api/workflows/:id/cancel — cancel an open workflow
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const { comment } = req.body;
  const appUser = await getAppUser(user);
  const wf = await pool.query('SELECT * FROM mdm.workflow_instance WHERE id = $1', [req.params.id]);
  if (wf.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  const current = wf.rows[0];
  if (current.completed_at) { res.status(400).json({ error: 'Workflow is already completed' }); return; }

  // Only the creator, assigned user, or an admin can cancel
  const canCancel = current.created_by === user || current.assigned_to === user
    || (appUser.mdm_roles || []).includes('MDM_ADMIN');
  if (!canCancel) {
    res.status(403).json({ error: 'Only the creator, assigned user, or an MDM Admin can cancel a workflow' });
    return;
  }
  if (!(await workflowInScope(user, req.params.id))) {
    res.status(403).json({ error: 'This entity is outside your country scope' });
    return;
  }

  await withUser(user, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO mdm.workflow_step_log (workflow_id, from_stage, to_stage, action, performed_by, comment) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.params.id, current.current_stage, 'CANCELLED', 'CANCEL', user, comment || 'Cancelled by user']
      );
      await client.query(
        'UPDATE mdm.workflow_instance SET current_stage = $2, updated_at = NOW(), completed_at = NOW() WHERE id = $1',
        [req.params.id, 'CANCELLED']
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  });

  res.json({ cancelled: true, workflow_id: current.id });
}));

// PUT /api/workflows/:id/assign — reassign a workflow
router.put('/:id/assign', asyncHandler(async (req, res) => {
  const user = req.headers['x-mdm-user'] as string;
  const { assigned_to, assigned_role, priority } = req.body;
  const appUser = await getAppUser(user);
  const wf = await pool.query('SELECT * FROM mdm.workflow_instance WHERE id = $1', [req.params.id]);
  if (wf.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  const current = wf.rows[0];
  if (current.completed_at) { res.status(400).json({ error: 'Workflow is already completed' }); return; }

  // Only admin, the current assignee, or the creator can reassign
  const canReassign = current.created_by === user || current.assigned_to === user
    || (appUser.mdm_roles || []).includes('MDM_ADMIN');
  if (!canReassign) {
    res.status(403).json({ error: 'Only the creator, current assignee, or an MDM Admin can reassign' });
    return;
  }
  if (!(await workflowInScope(user, req.params.id))) {
    res.status(403).json({ error: 'This entity is outside your country scope' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [req.params.id];
  let idx = 2;
  if (assigned_to !== undefined) { updates.push(`assigned_to = $${idx++}`); params.push(assigned_to); }
  if (assigned_role !== undefined) { updates.push(`assigned_role = $${idx++}`); params.push(assigned_role); }
  if (priority !== undefined) { updates.push(`priority = $${idx++}`); params.push(priority); }
  if (updates.length === 0) { res.status(400).json({ error: 'Provide assigned_to, assigned_role, and/or priority' }); return; }
  updates.push('updated_at = NOW()');

  await pool.query(`UPDATE mdm.workflow_instance SET ${updates.join(', ')} WHERE id = $1`, params);

  // Log the reassignment
  await pool.query(
    'INSERT INTO mdm.workflow_step_log (workflow_id, from_stage, to_stage, action, performed_by, comment) VALUES ($1, $2, $2, $3, $4, $5)',
    [req.params.id, current.current_stage, 'REASSIGN', user, `Reassigned to ${assigned_to || assigned_role || 'unset'}`]
  );

  const updated = await pool.query('SELECT * FROM mdm.workflow_instance WHERE id = $1', [req.params.id]);
  res.json(updated.rows[0]);
}));

export default router;
