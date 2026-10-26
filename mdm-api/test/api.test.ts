import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getApp, users, as, adminPool, type TestUser } from './helpers.js';

let app: Express;
let admin: TestUser;
let steward: TestUser | undefined;
let viewer: TestUser | undefined;

beforeAll(async () => {
  app = await getApp();
  ({ admin, steward, viewer } = await users());
});

describe('health and readiness', () => {
  it('liveness is public', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('readiness checks both pools, migrations and config', async () => {
    const r = await request(app).get('/api/ready');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ready');
    expect(Object.keys(r.body.checks).sort()).toEqual(['admin_db', 'config', 'migrations', 'user_db']);
  });

  it('every response carries a request id', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('list paging contract', () => {
  it('unpaged requests keep returning a plain array', async () => {
    const r = await as(app, admin.email).get('/api/entities/customer');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('?page returns an envelope with total, page and size', async () => {
    const all = (await as(app, admin.email).get('/api/entities/customer')).body as unknown[];
    const r = await as(app, admin.email).get('/api/entities/customer?page=0&size=2');
    expect(r.body).toMatchObject({ total: all.length, page: 0, size: 2 });
    expect(r.body.rows.length).toBe(Math.min(2, all.length));
    expect(r.body.rows[0].__total).toBeUndefined();
  });

  it('pages do not overlap and cover the whole list', async () => {
    const all = (await as(app, admin.email).get('/api/entities/customer')).body as { id: string }[];
    const seen = new Set<string>();
    for (let page = 0; page * 3 < all.length; page++) {
      const r = await as(app, admin.email).get(`/api/entities/customer?page=${page}&size=3&sort=legal_name:asc`);
      for (const row of r.body.rows) { expect(seen.has(row.id)).toBe(false); seen.add(row.id); }
    }
    expect(seen.size).toBe(all.length);
  });

  it('sorts on allowed fields and ignores unknown ones', async () => {
    const asc = (await as(app, admin.email).get('/api/entities/customer?page=0&size=500&sort=legal_name:asc')).body.rows as { id: string }[];
    const expected = (await (await adminPool()).query('SELECT id FROM mdm.customer WHERE is_deleted = false ORDER BY legal_name ASC NULLS LAST, updated_at DESC, id')).rows;
    expect(asc.map(r => r.id)).toEqual(expected.map((r: { id: string }) => r.id));
    const bogus = await as(app, admin.email).get('/api/entities/customer?page=0&size=5&sort=legal_name;drop table x:asc');
    expect(bogus.status).toBe(200);
  });

  it('search narrows the total', async () => {
    const all = (await as(app, admin.email).get('/api/entities/customer?page=0&size=1')).body.total as number;
    const first = (await as(app, admin.email).get('/api/entities/customer?page=0&size=1')).body.rows[0] as { legal_name: string };
    const r = await as(app, admin.email).get(`/api/entities/customer?page=0&size=50&q=${encodeURIComponent(first.legal_name)}`);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
    expect(r.body.total).toBeLessThanOrEqual(all);
  });

  it('facets count values for the summary and filter pickers', async () => {
    const r = await as(app, admin.email).get('/api/entities/customer/facets');
    expect(r.status).toBe(200);
    const stageTotal = (r.body.facets.lifecycle_stage as { count: number }[]).reduce((s, f) => s + f.count, 0);
    expect(stageTotal).toBe(r.body.total);
  });

  it('size is capped', async () => {
    const r = await as(app, admin.email).get('/api/audit?page=0&size=100000');
    expect(r.body.size).toBe(500);
  });
});

describe('country scope (RLS)', () => {
  it('a scoped steward only sees records in their countries', async () => {
    if (!steward) return;
    const r = await as(app, steward.email).get('/api/entities/customer?page=0&size=500');
    expect(r.status).toBe(200);
    for (const row of r.body.rows as { country_code: string | null }[]) {
      if (row.country_code) expect(steward.country_scope).toContain(row.country_code);
    }
    const adminTotal = (await as(app, admin.email).get('/api/entities/customer?page=0&size=1')).body.total;
    expect(r.body.total).toBeLessThanOrEqual(adminTotal);
  });

  it('records outside the scope are not found', async () => {
    if (!steward) return;
    const all = (await as(app, admin.email).get('/api/entities/customer')).body as { id: string; country_code: string | null }[];
    const outside = all.find(c => c.country_code && !steward!.country_scope!.includes(c.country_code));
    if (!outside) return;
    const r = await as(app, steward.email).get(`/api/entities/customer/${outside.id}`);
    expect(r.status).toBe(404);
  });
});

describe('roles', () => {
  it('viewers cannot write', async () => {
    if (!viewer) return;
    const r = await as(app, viewer.email).post('/api/entities/customer', { legal_name: 'Should Not Exist', source_system: 'TEST', source_id: 'X' });
    expect(r.status).toBe(403);
  });

  it('unknown callers are rejected', async () => {
    const r = await request(app).get('/api/entities/customer');
    expect(r.status).toBe(401);
  });
});

describe('workflows', () => {
  it('open workflows are paged and carry their next transitions', async () => {
    const r = await as(app, admin.email).get('/api/workflows?page=0&size=5');
    expect(r.status).toBe(200);
    expect(typeof r.body.total).toBe('number');
    for (const w of r.body.rows) expect(Array.isArray(w.available_transitions)).toBe(true);
    const counts = await as(app, admin.email).get('/api/workflows/counts');
    expect(counts.body.reduce((s: number, c: { count: number }) => s + c.count, 0)).toBe(r.body.total);
  });

  it('creating a record opens exactly one onboarding workflow', async () => {
    const created = await as(app, admin.email).post('/api/entities/customer', {
      legal_name: `Workflow Test ${Date.now()}`, source_system: 'TEST', source_id: `WF-${Date.now()}`, country_code: 'FRA',
    });
    expect(created.status).toBe(201);
    const wf = (await (await adminPool()).query('SELECT workflow_type FROM mdm.workflow_instance WHERE entity_id = $1', [created.body.id])).rows;
    expect(wf.filter(w => w.workflow_type === 'ONBOARDING')).toHaveLength(1);
  });
});
