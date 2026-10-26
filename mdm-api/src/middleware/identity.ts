import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import pool from '../db.js';

/**
 * Resolves the caller's identity and writes it to req.headers['x-mdm-user'] (the
 * app_user email) which every route, RLS session and audit trail reads.
 *
 *  spcs — Snowflake ingress sets Sf-Context-Current-User (the Snowflake login);
 *         mapped to mdm.app_user.sf_user. Client-sent x-mdm-user is ignored.
 *  dev  — MDM_DEV_AUTH=1: trust the x-mdm-user header (local user switcher).
 *  none — neither: every API call except health/config is 401.
 */
export type AuthMode = 'spcs' | 'dev' | 'none';

export const AUTH_MODE: AuthMode =
  (process.env.MDM_AUTH_MODE as AuthMode) ||
  (fs.existsSync('/snowflake/session/token') ? 'spcs'
    : process.env.MDM_DEV_AUTH === '1' ? 'dev' : 'none');

const SF_USER_HEADER = 'sf-context-current-user';
const PUBLIC_PATHS = ['/api/health', '/api/ready', '/api/config', '/api/auth/me'];
const TTL_MS = 30_000;
const sfCache = new Map<string, { email: string | null; at: number }>();
const devCache = new Map<string, { ok: boolean; at: number }>();

export function clearIdentityCache() { sfCache.clear(); devCache.clear(); }

async function isActiveUser(email: string): Promise<boolean> {
  const hit = devCache.get(email);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  const r = await pool.query('SELECT 1 FROM mdm.app_user WHERE email = $1 AND is_active = true', [email]);
  devCache.set(email, { ok: r.rows.length > 0, at: Date.now() });
  return r.rows.length > 0;
}

async function emailForSfUser(sfUser: string): Promise<string | null> {
  const key = sfUser.toUpperCase();
  const hit = sfCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.email;
  const r = await pool.query(
    'SELECT email FROM mdm.app_user WHERE upper(sf_user) = $1 AND is_active = true', [key]);
  const email = r.rows[0]?.email ?? null;
  sfCache.set(key, { email, at: Date.now() });
  return email;
}

declare module 'express-serve-static-core' {
  interface Request { sfUser?: string; authenticated?: boolean }
}

export async function identity(req: Request, res: Response, next: NextFunction) {
  try {
    let email = '';
    if (AUTH_MODE === 'spcs') {
      const sfUser = (req.headers[SF_USER_HEADER] as string) || '';
      req.sfUser = sfUser;
      if (sfUser) email = (await emailForSfUser(sfUser)) || '';
    } else if (AUTH_MODE === 'dev') {
      const claimed = (req.headers['x-mdm-user'] as string) || '';
      if (claimed && await isActiveUser(claimed)) email = claimed;
      else if (claimed && req.path.startsWith('/api/auth/me')) {
        res.status(401).json({ authenticated: false, auth_mode: AUTH_MODE, sf_user: null, email: claimed });
        return;
      }
    }
    req.headers['x-mdm-user'] = email;
    req.authenticated = !!email;

    if (!email && req.path.startsWith('/api') && !PUBLIC_PATHS.some(p => req.path.startsWith(p))) {
      res.status(401).json({ error: 'Not authenticated', auth_mode: AUTH_MODE, sf_user: req.sfUser || null });
      return;
    }
    next();
  } catch (err) { next(err); }
}
