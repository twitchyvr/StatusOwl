/**
 * StatusOwl — GNAP Middleware
 *
 * Express middleware for GNAP token validation.
 * Falls back to API key auth if no GNAP token is present.
 */

import { Request, Response, NextFunction } from 'express';
import { introspectToken, hasScope } from './gnap.js';
import { requireAuth } from '../api/auth.js';
import type { AccessScope, AccessToken } from './gnap.js';

// Extend Express Request to include GNAP token info
declare global {
  namespace Express {
    interface Request {
      gnapToken?: AccessToken;
    }
  }
}

/**
 * Middleware that requires a valid GNAP token with the specified scope.
 * Falls back to API key auth if no Bearer token matches a GNAP token.
 */
export function requireScope(scope: AccessScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const tokenValue = authHeader.slice(7);

      // Try GNAP token first
      const result = introspectToken(tokenValue);
      if (result.ok && result.data) {
        // Valid GNAP token — check scope
        if (!hasScope(result.data, scope)) {
          res.status(403).json({
            ok: false,
            error: {
              code: 'INSUFFICIENT_SCOPE',
              message: `Required scope: ${scope}`,
            },
          });
          return;
        }

        req.gnapToken = result.data;
        return next();
      }
    }

    // Fall back to API key auth
    requireAuth(req, res, next);
  };
}
