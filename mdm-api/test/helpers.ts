import type { Express } from 'express';
import request from 'supertest';

let _app: Express | null = null;

/** The API under test, with configuration and country scope initialised against the test database. */
export async function getApp(): Promise<Express> {
  if (_app) return _app;
  const { createApp, readiness } = await import('../src/app.js');
  const { initConfigStore } = await import('../src/config.js');
  const { initScope } = await import('../src/scope.js');
  const { default: pool } = await import('../src/db.js');
  await initConfigStore(pool);
  readiness.configStore = true;
  await initScope();
  _app = createApp();
  return _app;
}

export async function adminPool() {
  return (await import('../src/db.js')).default;
}

export interface TestUser { email: string; role: string; country_scope: string[] | null }

/** Seeded users by role (fresh databases get them from the migrations). */
export async function users(): Promise<{ admin: TestUser; steward: TestUser | undefined; viewer: TestUser | undefined }> {
  const pool = await adminPool();
  const rows = (await pool.query('SELECT email, role, country_scope FROM mdm.app_user ORDER BY email')).rows as TestUser[];
  const admin = rows.find(u => u.role === 'ADMIN');
  if (!admin) throw new Error('No ADMIN user seeded');
  return {
    admin,
    steward: rows.find(u => u.role === 'STEWARD' && u.country_scope?.length),
    viewer: rows.find(u => u.role === 'VIEWER'),
  };
}

export const as = (app: Express, email: string) => ({
  get: (url: string) => request(app).get(url).set('x-mdm-user', email),
  post: (url: string, body?: object) => request(app).post(url).set('x-mdm-user', email).send(body ?? {}),
  put: (url: string, body?: object) => request(app).put(url).set('x-mdm-user', email).send(body ?? {}),
});
