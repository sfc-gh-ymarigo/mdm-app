// PII masking, governance settings, notifications, merge/unmerge, hierarchy-change workflow, tombstones.
// Snowflake is not configured in tests (setupEnv), so PII access follows the user's direct role.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { getApp, adminPool, users, as, type TestUser } from './helpers.js';

let app: Express;
let admin: TestUser;
let steward: TestUser;
const stamp = Date.now();

/** Creates a customer as the admin (country in the steward's scope) and returns it. */
async function customer(name: string, extra: Record<string, unknown> = {}) {
  const r = await as(app, admin.email).post('/api/entities/customer', {
    legal_name: `${name} ${stamp}`, source_system: 'TEST', source_id: `${name}-${stamp}-${Math.random()}`,
    country_code: steward.country_scope?.[0] ?? 'FRA', ...extra,
  });
  expect(r.status).toBe(201);
  return r.body as { id: string; email: string | null; parent_id: string | null };
}

beforeAll(async () => {
  app = await getApp();
  const u = await users();
  admin = u.admin;
  if (!u.steward) throw new Error('No scoped steward seeded');
  steward = u.steward;
});

describe('PII masking (one rule for the app and Snowflake)', () => {
  it('masks PII for a role outside the unmask list, not for the admin', async () => {
    const c = await customer('Pii Mask', { email: 'contact@pii-test.example' });
    const asSteward = await as(app, steward.email).get(`/api/entities/customer/${c.id}`);
    expect(asSteward.status).toBe(200);
    expect(asSteward.headers['x-mdm-pii']).toBe('masked');
    expect(asSteward.body.email).toBe('***@pii-test.example');
    const asAdmin = await as(app, admin.email).get(`/api/entities/customer/${c.id}`);
    expect(asAdmin.headers['x-mdm-pii']).toBeUndefined();
    expect(asAdmin.body.email).toBe('contact@pii-test.example');
  });

  it('keeps timestamps intact in masked responses', async () => {
    const c = await customer('Pii Dates', { email: 'dates@pii-test.example' });
    const r = await as(app, steward.email).get(`/api/entities/customer/${c.id}`);
    expect(r.headers['x-mdm-pii']).toBe('masked');
    expect(typeof r.body.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(r.body.created_at))).toBe(false);
  });

  it('drops PII from writes by masked users, keeps the other fields', async () => {
    const c = await customer('Pii Write', { email: 'keep@pii-test.example' });
    const r = await as(app, steward.email).put(`/api/entities/customer/${c.id}`, { email: 'evil@x.example', city: 'Lille' });
    expect(r.status).toBe(200);
    const row = (await (await adminPool()).query('SELECT email, city FROM mdm.customer WHERE id = $1', [c.id])).rows[0];
    expect(row).toEqual({ email: 'keep@pii-test.example', city: 'Lille' });
  });

  it('tells the UI which fields are masked', async () => {
    const me = (await as(app, steward.email).get('/api/auth/me')).body;
    expect(me.pii_clear).toBe(false);
    expect(me.pii_masked_fields).toContain('email');
    expect((await as(app, admin.email).get('/api/auth/me')).body.pii_clear).toBe(true);
  });
});

describe('governance settings', () => {
  it('is admin only and validates its input', async () => {
    expect((await as(app, steward.email).put('/api/admin/governance/pii', { roles: ['MDM_ADMIN_ROLE'] })).status).toBe(403);
    expect((await as(app, admin.email).put('/api/admin/governance/pii', { roles: ['bad role;'] })).status).toBe(400);
    expect((await as(app, admin.email).put('/api/admin/governance/pii', { fields: { customer: ['no_such_field'] } })).status).toBe(400);
  });

  it('adding a role to the unmask list clears PII for its users', async () => {
    const roles = [...new Set(['MDM_ADMIN_ROLE', 'MDM_STEWARD_FRA_BEL', 'MDM_STEWARD_DEU'])];
    try {
      // Saved even when Snowflake cannot be synced (502): the API applies it immediately
      const r = await as(app, admin.email).put('/api/admin/governance/pii', { roles });
      expect([200, 502]).toContain(r.status);
      expect(r.body.roles).toEqual(expect.arrayContaining(['MDM_STEWARD_FRA_BEL']));
      expect((await as(app, steward.email).get('/api/auth/me')).body.pii_clear).toBe(true);
    } finally {
      await as(app, admin.email).put('/api/admin/governance/pii', { roles: ['MDM_ADMIN_ROLE'] });
    }
    expect((await as(app, steward.email).get('/api/auth/me')).body.pii_clear).toBe(false);
  });
});

describe('notifications', () => {
  it('returns translatable messages and remembers what was read', async () => {
    await customer('Notif');   // opens an onboarding workflow for the steward role
    const first = (await as(app, admin.email).get('/api/notifications')).body;
    expect(Array.isArray(first.items)).toBe(true);
    expect(first.items.length).toBeGreaterThan(0);
    for (const n of first.items) {
      expect(typeof n.text).toBe('string');
      expect(typeof n.msg?.key).toBe('string');
    }
    const key = first.items[0].key as string;
    expect((await as(app, admin.email).post('/api/notifications/read', { keys: [key] })).status).toBe(200);
    const after = (await as(app, admin.email).get('/api/notifications')).body;
    expect(after.items.find((n: { key: string }) => n.key === key)?.read).toBe(true);
    expect((await as(app, admin.email).post('/api/notifications/read', { keys: [] })).status).toBe(400);
  });
});

describe('merge and unmerge', () => {
  it('merges a candidate into the survivor and restores it on unmerge', async () => {
    const a = await customer('Merge Alpha');
    const b = await customer('Merge Alpha Dup');
    const pool = await adminPool();
    const cand = (await pool.query(
      `INSERT INTO mdm.match_candidate (entity_type, entity_id_a, entity_id_b, match_score, match_method, match_fields)
       VALUES ('CUSTOMER', $1, $2, 95, 'FUZZY', '{}') RETURNING id`, [a.id, b.id])).rows[0].id;

    const merged = await as(app, admin.email).put(`/api/matches/${cand}`, { status: 'MERGED', survivor_id: a.id });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ status: 'MERGED', survivor_id: a.id, loser_id: b.id });
    expect((await pool.query('SELECT is_deleted FROM mdm.customer WHERE id = $1', [b.id])).rows[0].is_deleted).toBe(true);
    expect((await as(app, admin.email).put(`/api/matches/${cand}`, { status: 'MERGED' })).status).toBe(409);

    const un = await as(app, admin.email).post(`/api/matches/merges/${merged.body.merge_id}/unmerge`, {});
    expect(un.status).toBe(200);
    expect(un.body.status).toBe('UNMERGED');
    expect((await pool.query('SELECT is_deleted FROM mdm.customer WHERE id = $1', [b.id])).rows[0].is_deleted).toBe(false);
  });
});

describe('hierarchy change in workflow mode (generic router)', () => {
  it('opens a workflow instead of moving the record, and saves the other fields', async () => {
    const parent = await customer('Hier Parent');
    const child = await customer('Hier Child');
    const r = await as(app, admin.email).put(`/api/entities/customer/${child.id}`, { parent_id: parent.id, city: 'Namur' });
    expect(r.status).toBe(200);
    expect(r.body._hierarchy_workflow?.id).toBeTruthy();
    const row = (await (await adminPool()).query('SELECT parent_id, city FROM mdm.customer WHERE id = $1', [child.id])).rows[0];
    expect(row).toEqual({ parent_id: null, city: 'Namur' });
    const again = await as(app, admin.email).put(`/api/entities/customer/${child.id}`, { parent_id: parent.id });
    expect(again.status).toBe(409);
  });
});

describe('hard deletes', () => {
  it('leave a tombstone for the Snowflake views', async () => {
    const c = await customer('Tombstone');
    const pool = await adminPool();
    await pool.query('DELETE FROM mdm.workflow_step_log WHERE workflow_id IN (SELECT id FROM mdm.workflow_instance WHERE entity_id = $1)', [c.id]);
    await pool.query('DELETE FROM mdm.workflow_instance WHERE entity_id = $1', [c.id]);
    await pool.query('DELETE FROM mdm.customer WHERE id = $1', [c.id]);
    const t = (await pool.query("SELECT 1 FROM mdm.deleted_record WHERE table_name = 'customer' AND record_id = $1", [c.id])).rows;
    expect(t).toHaveLength(1);
  });
});

