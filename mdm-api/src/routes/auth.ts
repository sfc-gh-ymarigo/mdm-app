import { Router } from 'express';
import { canSeePii, piiFields } from '../pii.js';
import pool, { invalidateAppUser } from '../db.js';
import { asyncHandler } from '../asyncHandler.js';
import { requireAdmin } from '../middleware/requireRole.js';
import { checkScopeCodes } from '../scope.js';
import { AUTH_MODE, clearIdentityCache } from '../middleware/identity.js';
import { getEnabledModules } from '../config.js';

/** pii_clear + the fields shown masked to this user (the UI makes them read-only). */
async function piiInfo(email: string) {
  const clear = await canSeePii(email);
  return { pii_clear: clear, pii_masked_fields: clear ? [] : [...new Set(Object.values(piiFields()).flat())] };
}

const router = Router();

const SF_ROLE_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,254}$/;

// Snowflake row access policies map CURRENT_ROLE() to app_user.sf_role: a scoped user without
// a role sees nothing in Analyst, and two users sharing a role must share a scope.
async function mappingWarnings(email: string): Promise<string[]> {
  const me = (await pool.query('SELECT role, sf_role, country_scope FROM mdm.app_user WHERE email = $1', [email])).rows[0];
  if (!me) return [];
  const out: string[] = [];
  if (!me.sf_role) out.push('No Snowflake role (sf_role): this user will see no data in Cortex Analyst/Agent');
  else {
    const clash = await pool.query(
      `SELECT email FROM mdm.app_user WHERE upper(sf_role) = upper($1) AND email <> $2 AND is_active
         AND coalesce(country_scope, '{}') IS DISTINCT FROM coalesce($3::varchar[], '{}')`, [me.sf_role, email, me.country_scope]);
    if (clash.rows.length) out.push(`Snowflake role ${me.sf_role} is shared with ${clash.rows.map(r => r.email).join(', ')} who have a different country scope; Snowflake applies the union of both scopes`);
  }
  return out;
}

// GET /api/auth/users — list app users (any authenticated user: needed for workflow assignment)
router.get('/users', asyncHandler(async (_req, res) => {
  const result = await pool.query('SELECT email, display_name, role, country_scope, entity_scope, mdm_roles, is_active, sf_user, sf_role FROM mdm.app_user ORDER BY role, display_name');
  res.json(result.rows);
}));

// POST /api/auth/users — create a new user (admin only: scopes control data access)
router.post('/users', requireAdmin, asyncHandler(async (req, res) => {
  const { email, display_name, role, country_scope, entity_scope, mdm_roles, sf_user, sf_role } = req.body;
  if (sf_role && !SF_ROLE_RE.test(sf_role)) { res.status(400).json({ error: 'Invalid Snowflake role name' }); return; }
  if (!email || !display_name) { res.status(400).json({ error: 'email and display_name are required' }); return; }
  const scopeErr = checkScopeCodes(country_scope);
  if (scopeErr) { res.status(400).json({ error: scopeErr }); return; }
  const result = await pool.query(
    `INSERT INTO mdm.app_user (email, display_name, role, country_scope, entity_scope, mdm_roles, sf_user, sf_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [email, display_name, role || 'VIEWER', country_scope ? country_scope.map((c: string) => c.toUpperCase()) : null, entity_scope || getEnabledModules().map(m => m.id.toUpperCase()), mdm_roles || [], sf_user ? String(sf_user).toUpperCase() : null, sf_role ? String(sf_role).toUpperCase() : null]
  );
  invalidateAppUser(email);
  clearIdentityCache();
  res.status(201).json({ ...result.rows[0], warnings: await mappingWarnings(email) });
}));

// PUT /api/auth/users/:email — update user (admin only)
router.put('/users/:email', requireAdmin, asyncHandler(async (req, res) => {
  const { display_name, role, country_scope, entity_scope, mdm_roles, is_active, sf_user, sf_role } = req.body;
  if (sf_role && !SF_ROLE_RE.test(sf_role)) { res.status(400).json({ error: 'Invalid Snowflake role name' }); return; }
  if (country_scope !== undefined) {
    const scopeErr = checkScopeCodes(country_scope);
    if (scopeErr) { res.status(400).json({ error: scopeErr }); return; }
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (display_name !== undefined) { sets.push(`display_name = $${idx++}`); params.push(display_name); }
  if (role !== undefined) { sets.push(`role = $${idx++}`); params.push(role); }
  if (country_scope !== undefined) { sets.push(`country_scope = $${idx++}`); params.push(Array.isArray(country_scope) ? country_scope.map((c: string) => c.toUpperCase()) : null); }
  if (entity_scope !== undefined) { sets.push(`entity_scope = $${idx++}`); params.push(entity_scope); }
  if (mdm_roles !== undefined) { sets.push(`mdm_roles = $${idx++}`); params.push(mdm_roles); }
  if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active); }
  if (sf_user !== undefined) { sets.push(`sf_user = $${idx++}`); params.push(sf_user ? String(sf_user).toUpperCase() : null); }
  if (sf_role !== undefined) { sets.push(`sf_role = $${idx++}`); params.push(sf_role ? String(sf_role).toUpperCase() : null); }
  if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  params.push(req.params.email);
  const result = await pool.query(`UPDATE mdm.app_user SET ${sets.join(', ')} WHERE email = $${idx} RETURNING *`, params);
  if (result.rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }
  invalidateAppUser(req.params.email);
  clearIdentityCache();
  res.json({ ...result.rows[0], warnings: await mappingWarnings(req.params.email) });
}));

// DELETE /api/auth/users/:email — deactivate user (soft delete, admin only)
router.delete('/users/:email', requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query('UPDATE mdm.app_user SET is_active = false WHERE email = $1 RETURNING *', [req.params.email]);
  if (result.rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }
  invalidateAppUser(req.params.email);
  clearIdentityCache();
  res.json({ deactivated: true, email: req.params.email });
}));

// GET /api/auth/me — get current user profile + permissions
router.get('/me', asyncHandler(async (req, res) => {
  const email = req.headers['x-mdm-user'] as string;
  const result = email
    ? await pool.query('SELECT * FROM mdm.app_user WHERE email = $1 AND is_active = true', [email])
    : { rows: [] };
  if (result.rows.length === 0) {
    // Unknown / unmapped caller: no access. The UI shows its "not provisioned" screen.
    res.status(401).json({ authenticated: false, auth_mode: AUTH_MODE, sf_user: req.sfUser || null, email: email || null });
    return;
  }
  res.json({ ...result.rows[0], authenticated: true, auth_mode: AUTH_MODE, ...(await piiInfo(email)) });
}));

export default router;
