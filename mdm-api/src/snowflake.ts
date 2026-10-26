import fs from 'fs';
import crypto from 'crypto';
import snowflake from 'snowflake-sdk';
import { sfObjects } from './config.js';
import { logger } from './logger.js';

/**
 * Snowflake access for the API (SQL via snowflake-sdk, REST via sfFetch).
 *
 * Auth mode is picked from the environment, first match wins:
 *   oauth    — /snowflake/session/token exists (running in SPCS)
 *   keypair  — SF_PRIVATE_KEY_PATH (or SF_PRIVATE_KEY) set
 *   pat      — SF_PAT set (programmatic access token)
 *   password — SF_PASSWORD set AND SF_ALLOW_PASSWORD=1 (explicit opt-in only)
 *
 * One connection per Snowflake role, so a role is fixed for the life of a
 * connection and concurrent requests never see each other's USE ROLE.
 */
const SPCS_TOKEN_PATH = '/snowflake/session/token';

export type SfAuthMode = 'oauth' | 'keypair' | 'pat' | 'password' | 'none';

const ACCOUNT = process.env.SNOWFLAKE_ACCOUNT || process.env.SF_ACCOUNT || '';
const USER = process.env.SF_USER || '';
const PRIVATE_KEY_PATH = process.env.SF_PRIVATE_KEY_PATH || '';
const PRIVATE_KEY_PASS = process.env.SF_PRIVATE_KEY_PASSPHRASE || undefined;
const PAT = process.env.SF_PAT || '';
const PASSWORD = process.env.SF_PASSWORD || '';

export const SF_AUTH_MODE: SfAuthMode =
  fs.existsSync(SPCS_TOKEN_PATH) ? 'oauth'
    : (PRIVATE_KEY_PATH || process.env.SF_PRIVATE_KEY) ? 'keypair'
    : PAT ? 'pat'
    : (PASSWORD && process.env.SF_ALLOW_PASSWORD === '1') ? 'password'
    : 'none';

export function sfHost(): string {
  if (process.env.SNOWFLAKE_HOST) return process.env.SNOWFLAKE_HOST;
  return `${ACCOUNT.toLowerCase().replace(/_/g, '-')}.snowflakecomputing.com`;
}

function spcsToken(): string {
  // Re-read every time: SPCS refreshes the file in place.
  return fs.readFileSync(SPCS_TOKEN_PATH, 'utf8').trim();
}

function privateKeyPem(): string {
  if (process.env.SF_PRIVATE_KEY) return process.env.SF_PRIVATE_KEY.replace(/\\n/g, '\n');
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
}

function connectionOptions(role?: string): snowflake.ConnectionOptions {
  const { warehouse, database, analyticsSchema } = sfObjects();
  const common = { account: ACCOUNT, warehouse, database, schema: analyticsSchema, ...(role ? { role } : {}) };
  switch (SF_AUTH_MODE) {
    case 'oauth':
      return { ...common, host: process.env.SNOWFLAKE_HOST, authenticator: 'OAUTH', token: spcsToken() } as snowflake.ConnectionOptions;
    case 'keypair':
      return { ...common, username: USER, authenticator: 'SNOWFLAKE_JWT', privateKey: privateKeyPem(), privateKeyPass: PRIVATE_KEY_PASS } as snowflake.ConnectionOptions;
    case 'pat':
      return { ...common, username: USER, authenticator: 'PROGRAMMATIC_ACCESS_TOKEN', token: PAT } as snowflake.ConnectionOptions;
    case 'password':
      return { ...common, username: USER, password: PASSWORD, authenticator: 'SNOWFLAKE' };
    default:
      throw new Error('Snowflake not configured: set SF_PRIVATE_KEY_PATH, SF_PAT, or run in SPCS');
  }
}

// ── SQL ──────────────────────────────────────────────────────────────────────

const DEFAULT_ROLE = '';
const connections = new Map<string, snowflake.Connection>();
const pending = new Map<string, Promise<snowflake.Connection>>();
const lastFailure = new Map<string, number>();
// Password logins lock the user after repeated failures, so back off hard there.
const COOLDOWN_MS = SF_AUTH_MODE === 'password' ? 15 * 60_000 : 30_000;

function getConnection(role = DEFAULT_ROLE): Promise<snowflake.Connection> {
  const key = role.toUpperCase();
  const existing = connections.get(key);
  if (existing?.isUp()) return Promise.resolve(existing);

  const failedAt = lastFailure.get(key) || 0;
  if (failedAt && Date.now() - failedAt < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - failedAt)) / 1000);
    return Promise.reject(new Error(`Snowflake connection on cooldown (${remaining}s remaining). Last attempt failed.`));
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const p = new Promise<snowflake.Connection>((resolve, reject) => {
    const conn = snowflake.createConnection(connectionOptions(role || undefined));
    conn.connect(err => {
      pending.delete(key);
      if (err) {
        lastFailure.set(key, Date.now());
        logger.error({ auth: SF_AUTH_MODE, role, err: err.message }, 'Snowflake connection failed');
        reject(err);
        return;
      }
      lastFailure.delete(key);
      connections.set(key, conn);
      logger.info({ auth: SF_AUTH_MODE, role }, 'Snowflake connected');
      resolve(conn);
    });
  });
  pending.set(key, p);
  return p;
}

function execSql(conn: snowflake.Connection, sql: string, binds?: snowflake.Binds): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: (err, _stmt, rows) => {
        if (err) reject(err);
        else resolve((rows || []) as Record<string, unknown>[]);
      },
    });
  });
}

export function resetCooldown() {
  lastFailure.clear();
  for (const c of connections.values()) c.destroy(() => {});
  connections.clear();
}

/** Run SQL as the service identity, or as a specific Snowflake role (own connection). */
export async function sfQuery(sql: string, role?: string, binds?: snowflake.Binds): Promise<Record<string, unknown>[]> {
  const conn = await getConnection(role || DEFAULT_ROLE);
  return execSql(conn, sql, binds);
}

// ── REST (Cortex Analyst, Cortex Agent, …) ───────────────────────────────────

let sessionToken: { token: string; exp: number } | null = null;

function keypairJwt(): string {
  const key = crypto.createPrivateKey({ key: privateKeyPem(), passphrase: PRIVATE_KEY_PASS });
  const pubDer = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const fp = 'SHA256:' + crypto.createHash('sha256').update(pubDer).digest('base64');
  const acct = ACCOUNT.toUpperCase().split('.')[0];
  const qualified = `${acct}.${USER.toUpperCase()}`;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: `${qualified}.${fp}`, sub: qualified, iat: now, exp: now + 3540 })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

async function passwordSessionToken(): Promise<string> {
  if (sessionToken && Date.now() < sessionToken.exp) return sessionToken.token;
  const res = await fetch(`https://${sfHost()}/session/v1/login-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ data: { ACCOUNT_NAME: ACCOUNT, LOGIN_NAME: USER, PASSWORD, CLIENT_APP_ID: 'MDM', CLIENT_APP_VERSION: '1.0' } }),
  });
  const body = await res.json() as { success: boolean; data?: { token: string }; message?: string };
  if (!body.success || !body.data?.token) throw new Error(`Snowflake login failed: ${body.message || 'unknown'}`);
  sessionToken = { token: body.data.token, exp: Date.now() + 3_500_000 };
  return sessionToken.token;
}

async function authHeaders(): Promise<Record<string, string>> {
  switch (SF_AUTH_MODE) {
    case 'oauth':
      return { Authorization: `Bearer ${spcsToken()}`, 'X-Snowflake-Authorization-Token-Type': 'OAUTH' };
    case 'keypair':
      return { Authorization: `Bearer ${keypairJwt()}`, 'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT' };
    case 'pat':
      return { Authorization: `Bearer ${PAT}`, 'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN' };
    case 'password':
      return { Authorization: `Snowflake Token="${await passwordSessionToken()}"` };
    default:
      throw new Error('Snowflake not configured: set SF_PRIVATE_KEY_PATH, SF_PAT, or run in SPCS');
  }
}

/** Authenticated call to a Snowflake REST endpoint, e.g. sfFetch('/api/v2/cortex/analyst/message', {...}). */
export async function sfFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(await authHeaders()), ...(init.headers as Record<string, string> || {}) };
  return fetch(`https://${sfHost()}${path}`, { ...init, headers });
}

export function snowflakeConfigured(): boolean { return SF_AUTH_MODE !== 'none'; }
