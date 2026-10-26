import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getAppUser } from '../db.js';

type AppRole = 'ADMIN' | 'STEWARD' | 'VIEWER';

const ROLE_RANK: Record<string, number> = { ADMIN: 3, STEWARD: 2, VIEWER: 1 };

/**
 * Express middleware that enforces a minimum role level.
 * Resolves the user set by the identity middleware via getAppUser() (cached).
 * Returns 403 if the user's role is below the required level.
 */
export function requireRole(minRole: AppRole): RequestHandler {
  const minRank = ROLE_RANK[minRole];
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.headers['x-mdm-user'] as string;
      if (!email) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const user = await getAppUser(email);
      const userRank = ROLE_RANK[user.role] || 0;
      if (userRank < minRank) {
        res.status(403).json({
          error: 'Insufficient permissions',
          required: minRole,
          current: user.role,
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAdmin: RequestHandler = requireRole('ADMIN');
export const requireEditor: RequestHandler = requireRole('STEWARD');
