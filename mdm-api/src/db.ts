import pg from 'pg';
import fs from 'fs';
import { logger } from './logger.js';

const isRemote = process.env.PG_HOST && process.env.PG_HOST !== 'localhost';

// TLS: verify the server certificate when the instance CA is provided (PG_SSL_CA = PEM file
// path or the PEM itself). Without it the connection is encrypted but not verified.
function sslOptions(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (!isRemote) return false;
  const ca = process.env.PG_SSL_CA;
  if (!ca) {
    logger.warn('PG_SSL_CA not set: Postgres TLS certificate is NOT verified');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true, ca: ca.includes('BEGIN CERTIFICATE') ? ca : fs.readFileSync(ca, 'utf8') };
}

const base = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  ssl: sslOptions(),
};

// Admin pool (owner / BYPASSRLS): system jobs only — DQ runs, match scans, migrations, CDC setup.
const pool = new pg.Pool({
  ...base,
  user: process.env.PG_USER || 'snowflake_admin',
  password: process.env.PG_PASSWORD,
});

// User pool (mdm_app, NOBYPASSRLS): every user-facing request, so Postgres RLS enforces country scope.
const hasAppRole = !!process.env.PG_APP_USER;
if (!hasAppRole) {
  // Without mdm_app, user requests would run as the BYPASSRLS owner: allowed for local dev only.
  if (process.env.MDM_DEV_AUTH !== '1') {
    logger.fatal('PG_APP_USER is not set: refusing to start (user requests would bypass Postgres RLS)');
    process.exit(1);
  }
  logger.warn('PG_APP_USER not set — DEV ONLY: user requests run on the admin pool and Postgres RLS is NOT enforced');
}
export const userPool = hasAppRole
  ? new pg.Pool({ ...base, user: process.env.PG_APP_USER, password: process.env.PG_APP_PASSWORD })
  : pool;

// Idle clients can fail when the network drops (EHOSTUNREACH, ETIMEDOUT). Without a
// listener pg-pool re-throws and kills the process; the pool replaces the client itself.
for (const p of new Set([pool, userPool])) {
  p.on('error', err => logger.warn({ code: (err as NodeJS.ErrnoException).code, err: err.message }, 'Postgres idle client error — will reconnect'));
  // A checked-out client that loses its socket emits 'error' too; without a listener that kills the
  // process. The in-flight query still rejects, so the request fails cleanly.
  p.on('connect', client => client.on('error', err =>
    logger.warn({ code: (err as NodeJS.ErrnoException).code, err: err.message }, 'Postgres connection error')));
}

export interface AppUser {
  email: string;
  display_name: string;
  role: string;
  country_scope: string[] | null;
  mdm_roles: string[];
  is_active: boolean;
  sf_user?: string | null;
  sf_role?: string | null;
}

const userCache = new Map<string, { user: AppUser; ts: number }>();
const CACHE_TTL = 30_000;

export function invalidateAppUser(email?: string) {
  if (email) userCache.delete(email); else userCache.clear();
}

export async function getAppUser(email: string): Promise<AppUser> {
  const cached = userCache.get(email);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.user;
  const result = await pool.query('SELECT * FROM mdm.app_user WHERE email = $1 AND is_active = true', [email]);
  // Unknown users get an empty scope: they see nothing (RLS also denies them).
  const user: AppUser = result.rows.length > 0
    ? result.rows[0]
    : { email, display_name: email, role: 'VIEWER', country_scope: [], mdm_roles: [], is_active: true };
  userCache.set(email, { user, ts: Date.now() });
  return user;
}

export async function withUser<T>(email: string, fn: (client: pg.PoolClient, appUser: AppUser) => Promise<T>): Promise<T> {
  const appUser = await getAppUser(email);
  const client = await userPool.connect();
  try {
    // Session-level so callers may run their own BEGIN/COMMIT; reset before the
    // connection goes back to the pool so the identity never leaks to the next request.
    await client.query(`SELECT set_config('app.current_user', $1, false)`, [email || '']);
    return await fn(client, appUser);
  } finally {
    await client.query(`RESET app.current_user`).catch(() => {});
    client.release();
  }
}

// One-off query under the caller's identity (RLS applies).
export function userQuery(email: string, sql: string, params: unknown[] = []) {
  return withUser(email, client => client.query(sql, params));
}

// Drop-in replacement for `pool` in user-facing handlers: same query() shape, RLS applies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function userDb(email: string): { query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult<any>> } {
  return { query: (sql, params = []) => userQuery(email, sql, params) };
}

// Does the user's scope allow this country for the given module? Mirrors mdm.scope_allows().
export function scopeAllows(appUser: AppUser, countryScoped: boolean | undefined, country: string | null | undefined, nullOk = false): boolean {
  if (!countryScoped || appUser.country_scope === null) return true;
  if (country == null) return nullOk;
  return appUser.country_scope.includes(country);
}

export default pool;
