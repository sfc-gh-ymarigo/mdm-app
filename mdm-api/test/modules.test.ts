// Generic module support: per-module dashboard figures and the Snowflake SYNC_MODULES trigger.
// Snowflake is mocked: the test checks the CALL the API issues, not the procedure itself.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Express } from 'express';
import { getApp, users, as, type TestUser } from './helpers.js';

const calls: string[] = [];
let syncReplies: string[] = [];
vi.mock('../src/snowflake.js', async (orig) => ({
  ...(await orig<typeof import('../src/snowflake.js')>()),
  sfQuery: vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('SYNC_MODULES')) return [{ SYNC_MODULES: syncReplies.shift() ?? '{"status":"ok"}' }];
    return [];
  }),
}));

let app: Express;
let admin: TestUser;
let steward: TestUser;

beforeAll(async () => {
  process.env.MDM_SYNC_IN_TESTS = '1';
  process.env.MDM_SYNC_DEBOUNCE_MS = '50';
  process.env.MDM_SYNC_RETRY_MS = '50';
  app = await getApp();
  const u = await users();
  admin = u.admin;
  if (!u.steward) throw new Error('No scoped steward seeded');
  steward = u.steward;
});

describe('dashboard per module', () => {
  it('returns one block per enabled module, scoped to the caller', async () => {
    const cfg = await as(app, admin.email).get('/api/admin/modules');
    const enabled = (cfg.body as { id: string; enabled: boolean }[]).filter(m => m.enabled).map(m => m.id);

    const r = await as(app, admin.email).get('/api/stats/dashboard');
    expect(r.status).toBe(200);
    expect(r.body.modules.map((m: { id: string }) => m.id)).toEqual(enabled);
    const cust = r.body.modules.find((m: { id: string }) => m.id === 'customer');
    expect(cust.total).toBe(Object.values(cust.by_stage as Record<string, number>).reduce((a, b) => a + b, 0));
    expect(Array.isArray(cust.by_country)).toBe(true);
    expect(cust.breakdowns.every((b: { field: string }) => b.field !== 'country_code' && b.field !== 'lifecycle_stage')).toBe(true);

    const scoped = await as(app, steward.email).get('/api/stats/dashboard');
    const sc = scoped.body.modules.find((m: { id: string }) => m.id === 'customer');
    expect(sc.by_country.every((c: { country: string }) => steward.country_scope!.includes(c.country))).toBe(true);
    expect(sc.total).toBeLessThanOrEqual(cust.total);
  });
});

describe('Snowflake module sync', () => {
  it('calls SYNC_MODULES after a module change and retries while the mirror is behind', async () => {
    calls.length = 0;
    syncReplies = ['{"status":"pending"}', '{"status":"ok","modules":[]}'];
    const before = await as(app, admin.email).get('/api/admin/modules');
    const cust = (before.body as { id: string; allow_create: boolean }[]).find(m => m.id === 'customer')!;

    const r = await as(app, admin.email).put('/api/admin/modules/customer', { allow_create: cust.allow_create });
    expect(r.status).toBe(200);

    await vi.waitFor(async () => {
      const s = await as(app, admin.email).get('/api/admin/modules/sync');
      expect(s.body.state).toBe('ok');
    }, { timeout: 5000, interval: 50 });
    const syncCalls = calls.filter(c => c.includes('MDM_ANALYTICS.SYNC_MODULES'));
    expect(syncCalls).toHaveLength(2);
  });

  it('is admin only', async () => {
    const r = await as(app, steward.email).post('/api/admin/modules/sync', {});
    expect(r.status).toBe(403);
  });
});
