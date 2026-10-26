// Creates a disposable database for the test run, applies every migration, and drops it afterwards.
//   PG_TEST_DATABASE set  → use that (empty) database as-is and keep it (CI service container)
//   otherwise             → CREATE DATABASE mdm_test_<random> on the configured instance (needs CREATEDB)
import crypto from 'crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrateUp } from '../src/migrate.js';

const ssl = process.env.PG_SSL === '0' ? false : process.env.PG_HOST && process.env.PG_HOST !== 'localhost' ? { rejectUnauthorized: false } : false;
const admin = (database: string) => new pg.Client({
  host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD, database, ssl,
});

let created: string | null = null;

export async function setup(project: TestProject) {
  let database = process.env.PG_TEST_DATABASE;
  if (!database) {
    database = `mdm_test_${crypto.randomBytes(4).toString('hex')}`;
    const c = admin(process.env.PG_DATABASE || 'postgres');
    await c.connect();
    await c.query(`CREATE DATABASE ${database}`);
    await c.end();
    created = database;
  }
  const pool = new pg.Pool({
    host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD, database, ssl,
  });
  try {
    await migrateUp(pool, () => {});
    // CI creates mdm_app without a password (migration 008); give it the test password
    if (process.env.PG_APP_USER && process.env.PG_APP_PASSWORD && process.env.MDM_TEST_SET_APP_PASSWORD === '1') {
      await pool.query(`ALTER ROLE ${process.env.PG_APP_USER} PASSWORD '${process.env.PG_APP_PASSWORD.replace(/'/g, "''")}'`);
    }
  } finally { await pool.end(); }
  project.provide('pgDatabase', database);
}

export async function teardown() {
  if (!created) return;
  const c = admin(process.env.PG_DATABASE || 'postgres');
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${created} WITH (FORCE)`);
  await c.end();
}

declare module 'vitest' {
  export interface ProvidedContext { pgDatabase: string }
}
