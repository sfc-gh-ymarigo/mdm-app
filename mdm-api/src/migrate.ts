/**
 * Versioned Postgres migrations: postgres/NNN_name.sql, applied in order, each in its own
 * transaction under an advisory lock, recorded in mdm.schema_migrations with a checksum.
 *
 *   npm run migrate -- status            list applied / pending
 *   npm run migrate -- up                apply pending migrations
 *   npm run migrate -- baseline [NNN]    mark existing files (≤ NNN) as applied without running
 *                                        them — for databases created before the runner existed
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type pg from 'pg';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../postgres');
const LOCK_KEY = 72_610_001; // arbitrary, constant advisory-lock id for migrations

export interface MigrationFile { version: number; name: string; file: string; checksum: string }
export interface MigrationStatus extends MigrationFile { applied_at: Date | null }

export function migrationFiles(): MigrationFile[] {
  const files = fs.readdirSync(DIR).filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const seen = new Set<number>();
  return files.map(f => {
    const version = parseInt(f.slice(0, 3), 10);
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version} (${f})`);
    seen.add(version);
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    return { version, name: f.slice(4, -4), file: f, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}

async function ensureTable(client: pg.PoolClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS mdm`);
  await client.query(`CREATE TABLE IF NOT EXISTS mdm.schema_migrations (
    version    INT PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL,
    baseline   BOOLEAN NOT NULL
  )`);
}

async function withLock<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try { await ensureTable(client); return await fn(client); }
    finally { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {}); }
  } finally { client.release(); }
}

export async function migrationStatus(pool: pg.Pool): Promise<MigrationStatus[]> {
  return withLock(pool, async client => {
    const applied = new Map<number, { checksum: string; applied_at: Date }>(
      (await client.query('SELECT version, checksum, applied_at FROM mdm.schema_migrations')).rows.map(r => [r.version, r]));
    return migrationFiles().map(f => {
      const a = applied.get(f.version);
      if (a && a.checksum !== f.checksum) throw new Error(`Migration ${f.file} was changed after it was applied (checksum mismatch)`);
      return { ...f, applied_at: a?.applied_at ?? null };
    });
  });
}

export async function migrateUp(pool: pg.Pool, log = console.log): Promise<string[]> {
  return withLock(pool, async client => {
    const applied = new Map<number, string>(
      (await client.query('SELECT version, checksum FROM mdm.schema_migrations')).rows.map(r => [r.version, r.checksum]));
    const done: string[] = [];
    for (const f of migrationFiles()) {
      const prev = applied.get(f.version);
      if (prev) {
        if (prev !== f.checksum) throw new Error(`Migration ${f.file} was changed after it was applied (checksum mismatch)`);
        continue;
      }
      log(`  applying ${f.file}`);
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(DIR, f.file), 'utf8'));
        await client.query(
          'INSERT INTO mdm.schema_migrations (version, name, checksum, applied_at, baseline) VALUES ($1, $2, $3, now(), false)',
          [f.version, f.name, f.checksum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${f.file} failed: ${(e as Error).message}`);
      }
      done.push(f.file);
    }
    return done;
  });
}

/** Tables each baselined migration must already have created (sanity check before marking). */
const BASELINE_PROOF: Record<number, string> = {
  1: 'mdm.customer', 7: 'mdm.ref_codelist', 8: 'mdm.module_scope', 10: 'mdm.app_config', 11: 'mdm.ai_usage_log',
};

export async function migrateBaseline(pool: pg.Pool, upTo?: number): Promise<string[]> {
  return withLock(pool, async client => {
    const marked: string[] = [];
    for (const f of migrationFiles()) {
      if (upTo !== undefined && f.version > upTo) break;
      const proof = BASELINE_PROOF[f.version];
      if (proof && !(await client.query('SELECT to_regclass($1) AS t', [proof])).rows[0].t) {
        throw new Error(`Cannot baseline ${f.file}: ${proof} does not exist — run "up" instead`);
      }
      const r = await client.query(
        `INSERT INTO mdm.schema_migrations (version, name, checksum, applied_at, baseline)
         VALUES ($1, $2, $3, now(), true) ON CONFLICT (version) DO NOTHING`, [f.version, f.name, f.checksum]);
      if (r.rowCount) marked.push(f.file);
    }
    return marked;
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'status', arg] = process.argv.slice(2);
  const { default: pool } = await import('./db.js');
  try {
    if (cmd === 'up') {
      const done = await migrateUp(pool);
      console.log(done.length ? `Applied ${done.length} migration(s)` : 'Database is up to date');
    } else if (cmd === 'baseline') {
      const marked = await migrateBaseline(pool, arg ? parseInt(arg, 10) : undefined);
      console.log(`Baselined ${marked.length} migration(s): ${marked.join(', ') || '(none)'}`);
    } else {
      for (const s of await migrationStatus(pool)) {
        console.log(`${s.applied_at ? 'applied ' : 'PENDING '} ${s.file}${s.applied_at ? `  (${s.applied_at.toISOString()})` : ''}`);
      }
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
