/**
 * StatusOwl — GNAP Authorization
 *
 * Grant Negotiation and Authorization Protocol (RFC 9635)
 * Provides token-based authorization with resource-scoped permissions.
 */

import { randomUUID, createHash } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import type { Result } from '../core/index.js';

const log = createChildLogger('GNAP');

// ── Types ──

export type AccessScope = 'read' | 'write' | 'admin';

export interface GrantRequest {
  /** Client identifier (key fingerprint or client_id) */
  client: string;
  /** Requested access scopes */
  accessScopes: AccessScope[];
  /** Optional: specific resource identifiers */
  resources?: string[];
}

export interface AccessToken {
  value: string;
  scopes: AccessScope[];
  resources?: string[];
  clientId: string;
  expiresAt: string; // ISO datetime
  createdAt: string;
}

export interface GrantResponse {
  accessToken: AccessToken;
  continue?: {
    uri: string;
    accessToken: string;
  };
}

// ── In-memory token store (production would use database) ──

const tokenStore = new Map<string, AccessToken>();
const clientKeys = new Map<string, string>(); // clientId -> secret hash

// ── Core functions ──

/**
 * Register a client with their secret key.
 * Returns client ID.
 */
export function registerClient(clientId: string, secret: string): Result<{ clientId: string }> {
  const secretHash = createHash('sha256').update(secret).digest('hex');
  clientKeys.set(clientId, secretHash);
  log.info({ clientId }, 'GNAP client registered');
  return ok({ clientId });
}

/**
 * Authenticate a client by verifying their secret.
 */
export function authenticateClient(clientId: string, secret: string): boolean {
  const storedHash = clientKeys.get(clientId);
  if (!storedHash) return false;
  const providedHash = createHash('sha256').update(secret).digest('hex');
  return storedHash === providedHash;
}

/**
 * Process a GNAP grant request.
 * Validates the client and issues an access token with requested scopes.
 */
export function requestGrant(request: GrantRequest, clientSecret: string): Result<GrantResponse> {
  // Authenticate client
  if (!authenticateClient(request.client, clientSecret)) {
    return err('UNAUTHORIZED', 'Invalid client credentials');
  }

  // Validate scopes
  const validScopes: AccessScope[] = ['read', 'write', 'admin'];
  for (const scope of request.accessScopes) {
    if (!validScopes.includes(scope)) {
      return err('INVALID_SCOPE', `Invalid scope: ${scope}`);
    }
  }

  // Issue access token
  const token: AccessToken = {
    value: randomUUID(),
    scopes: request.accessScopes,
    resources: request.resources,
    clientId: request.client,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
    createdAt: new Date().toISOString(),
  };

  tokenStore.set(token.value, token);

  log.info({ clientId: request.client, scopes: token.scopes }, 'GNAP grant issued');

  return ok({
    accessToken: token,
  });
}

/**
 * Introspect a token — verify it exists, is not expired, and return its metadata.
 */
export function introspectToken(tokenValue: string): Result<AccessToken | null> {
  const token = tokenStore.get(tokenValue);
  if (!token) {
    return ok(null);
  }

  // Check expiry
  if (new Date(token.expiresAt) < new Date()) {
    tokenStore.delete(tokenValue);
    return ok(null);
  }

  return ok(token);
}

/**
 * Revoke a token.
 */
export function revokeToken(tokenValue: string): Result<boolean> {
  const existed = tokenStore.delete(tokenValue);
  if (existed) {
    log.info('GNAP token revoked');
  }
  return ok(existed);
}

/**
 * Rotate a token — revoke old one and issue a new one with same scopes.
 */
export function rotateToken(tokenValue: string): Result<AccessToken | null> {
  const existing = tokenStore.get(tokenValue);
  if (!existing) {
    return ok(null);
  }

  // Check expiry
  if (new Date(existing.expiresAt) < new Date()) {
    tokenStore.delete(tokenValue);
    return ok(null);
  }

  // Revoke old token
  tokenStore.delete(tokenValue);

  // Issue new token with same scopes
  const newToken: AccessToken = {
    value: randomUUID(),
    scopes: existing.scopes,
    resources: existing.resources,
    clientId: existing.clientId,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  tokenStore.set(newToken.value, newToken);

  log.info({ clientId: existing.clientId }, 'GNAP token rotated');
  return ok(newToken);
}

/**
 * Check if a token has a specific scope.
 */
export function hasScope(token: AccessToken, requiredScope: AccessScope): boolean {
  // Admin scope implies all other scopes
  if (token.scopes.includes('admin')) return true;
  // Write scope implies read
  if (requiredScope === 'read' && token.scopes.includes('write')) return true;
  return token.scopes.includes(requiredScope);
}

/**
 * Clear all tokens and clients (for testing).
 */
export function clearGnapStore(): void {
  tokenStore.clear();
  clientKeys.clear();
}
