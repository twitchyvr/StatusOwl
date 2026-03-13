/**
 * StatusOwl — API Authentication Middleware
 *
 * API key authentication for mutation endpoints.
 * Supports Authorization: Bearer <key> and X-API-Key headers.
 * If no API key is configured, authentication is skipped (dev mode).
 */

import { timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../core/index.js';

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses crypto.timingSafeEqual with Buffer conversion.
 * Returns false if lengths differ (length info is already leaked by HTTP).
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

/**
 * Extracts API key from request headers.
 * Checks Authorization: Bearer <key> and X-API-Key headers.
 */
function extractApiKey(req: Request): string | null {
  // Check Authorization: Bearer <key>
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }
  }

  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  return null;
}

/**
 * API key authentication middleware.
 * Skips authentication if no API key is configured (dev mode).
 * Returns 401 with JSON error on auth failure.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const config = getConfig();

  // Skip auth if no API key is configured (dev mode)
  if (!config.apiKey) {
    return next();
  }

  const providedKey = extractApiKey(req);

  if (!providedKey) {
    res.status(401).json({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key required. Provide it via Authorization: Bearer <key> or X-API-Key header.',
      },
    });
    return;
  }

  if (!safeCompare(providedKey, config.apiKey)) {
    res.status(401).json({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key.',
      },
    });
    return;
  }

  next();
}

/**
 * Creates an auth middleware that only applies if API key is configured.
 * Useful for conditionally applying auth based on configuration.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const config = getConfig();

  // If no API key configured, skip auth entirely
  if (!config.apiKey) {
    return next();
  }

  // If API key is configured, require valid key
  return requireAuth(req, res, next);
}
