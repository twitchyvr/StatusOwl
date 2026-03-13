/**
 * GNAP Authorization Tests
 *
 * Comprehensive tests for the GNAP module, including client registration,
 * authentication, grant requests, token lifecycle, scope checking, and middleware.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  registerClient,
  authenticateClient,
  requestGrant,
  introspectToken,
  revokeToken,
  rotateToken,
  hasScope,
  clearGnapStore,
} from '../src/auth/gnap.js';
import { requireScope } from '../src/auth/gnap-middleware.js';
import type { AccessToken } from '../src/auth/gnap.js';

// ── Mock helpers ──

function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers };
}

function createMockRes(): Partial<Response> & { statusCode: number; body: unknown } {
  const self = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      self.statusCode = code;
      return self;
    },
    json(data: unknown) {
      self.body = data;
      return self;
    },
  };
  return self;
}

function createMockNext(): NextFunction & { mock: { calls: unknown[][] } } {
  return vi.fn() as unknown as NextFunction & { mock: { calls: unknown[][] } };
}

// ── Test data ──

const TEST_CLIENT_ID = 'test-client-001';
const TEST_SECRET = 'super-secret-key-42';
const WRONG_SECRET = 'wrong-secret';

// ── Tests ──

describe('GNAP Core', () => {
  beforeEach(() => {
    clearGnapStore();
  });

  // ── Client Registration ──

  describe('registerClient', () => {
    it('should register a client and return the client ID', () => {
      const result = registerClient(TEST_CLIENT_ID, TEST_SECRET);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.clientId).toBe(TEST_CLIENT_ID);
      }
    });

    it('should allow re-registering the same client with a new secret', () => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
      const result = registerClient(TEST_CLIENT_ID, 'new-secret');
      expect(result.ok).toBe(true);

      // Old secret should no longer work
      expect(authenticateClient(TEST_CLIENT_ID, TEST_SECRET)).toBe(false);
      // New secret should work
      expect(authenticateClient(TEST_CLIENT_ID, 'new-secret')).toBe(true);
    });
  });

  // ── Client Authentication ──

  describe('authenticateClient', () => {
    beforeEach(() => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
    });

    it('should return true for valid credentials', () => {
      expect(authenticateClient(TEST_CLIENT_ID, TEST_SECRET)).toBe(true);
    });

    it('should return false for wrong secret', () => {
      expect(authenticateClient(TEST_CLIENT_ID, WRONG_SECRET)).toBe(false);
    });

    it('should return false for unknown client', () => {
      expect(authenticateClient('nonexistent-client', TEST_SECRET)).toBe(false);
    });

    it('should return false for empty credentials', () => {
      expect(authenticateClient('', '')).toBe(false);
    });
  });

  // ── Grant Requests ──

  describe('requestGrant', () => {
    beforeEach(() => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
    });

    it('should issue a grant with valid scopes', () => {
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read'] },
        TEST_SECRET,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.accessToken.value).toBeTruthy();
        expect(result.data.accessToken.scopes).toEqual(['read']);
        expect(result.data.accessToken.clientId).toBe(TEST_CLIENT_ID);
        expect(result.data.accessToken.expiresAt).toBeTruthy();
        expect(result.data.accessToken.createdAt).toBeTruthy();
      }
    });

    it('should issue a grant with multiple scopes', () => {
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read', 'write'] },
        TEST_SECRET,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.accessToken.scopes).toEqual(['read', 'write']);
      }
    });

    it('should include resources when provided', () => {
      const resources = ['service:abc', 'service:xyz'];
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read'], resources },
        TEST_SECRET,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.accessToken.resources).toEqual(resources);
      }
    });

    it('should fail with invalid client credentials', () => {
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read'] },
        WRONG_SECRET,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('should fail with unknown client', () => {
      const result = requestGrant(
        { client: 'unknown-client', accessScopes: ['read'] },
        TEST_SECRET,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('should fail with invalid scope', () => {
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read', 'destroy' as never] },
        TEST_SECRET,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SCOPE');
        expect(result.error.message).toContain('destroy');
      }
    });

    it('should set expiration approximately 1 hour from now', () => {
      const before = Date.now();
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read'] },
        TEST_SECRET,
      );
      const after = Date.now();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const expiresAt = new Date(result.data.accessToken.expiresAt).getTime();
        // Should be approximately 1 hour from now (within 2 seconds tolerance)
        expect(expiresAt).toBeGreaterThanOrEqual(before + 3600_000 - 2000);
        expect(expiresAt).toBeLessThanOrEqual(after + 3600_000 + 2000);
      }
    });
  });

  // ── Token Introspection ──

  describe('introspectToken', () => {
    let validTokenValue: string;

    beforeEach(() => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read', 'write'] },
        TEST_SECRET,
      );
      if (result.ok) {
        validTokenValue = result.data.accessToken.value;
      }
    });

    it('should return token metadata for a valid token', () => {
      const result = introspectToken(validTokenValue);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).not.toBeNull();
        expect(result.data!.value).toBe(validTokenValue);
        expect(result.data!.scopes).toEqual(['read', 'write']);
        expect(result.data!.clientId).toBe(TEST_CLIENT_ID);
      }
    });

    it('should return null for nonexistent token', () => {
      const result = introspectToken('nonexistent-token-value');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }
    });

    it('should return null for an expired token and remove it from the store', () => {
      // Issue a separate token we will expire
      const expiredResult = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['admin'] },
        TEST_SECRET,
      );
      expect(expiredResult.ok).toBe(true);
      if (!expiredResult.ok) return;

      const expiredTokenValue = expiredResult.data.accessToken.value;

      // Temporarily advance time by 2 hours using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(7200_000); // 2 hours

      const result = introspectToken(expiredTokenValue);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }

      vi.useRealTimers();

      // Token should be removed — introspect again returns null even with real time
      const result2 = introspectToken(expiredTokenValue);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.data).toBeNull();
      }
    });
  });

  // ── Token Revocation ──

  describe('revokeToken', () => {
    let tokenValue: string;

    beforeEach(() => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read'] },
        TEST_SECRET,
      );
      if (result.ok) {
        tokenValue = result.data.accessToken.value;
      }
    });

    it('should revoke an existing token', () => {
      const result = revokeToken(tokenValue);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(true);
      }

      // Token should no longer be introspectable
      const check = introspectToken(tokenValue);
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.data).toBeNull();
      }
    });

    it('should return false for nonexistent token', () => {
      const result = revokeToken('does-not-exist');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(false);
      }
    });

    it('should not affect other tokens when revoking one', () => {
      // Issue a second token
      const result2 = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['write'] },
        TEST_SECRET,
      );
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      const secondToken = result2.data.accessToken.value;

      // Revoke first token
      revokeToken(tokenValue);

      // Second token should still be valid
      const check = introspectToken(secondToken);
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.data).not.toBeNull();
        expect(check.data!.value).toBe(secondToken);
      }
    });
  });

  // ── Token Rotation ──

  describe('rotateToken', () => {
    let tokenValue: string;

    beforeEach(() => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
      const result = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read', 'write'], resources: ['svc:1'] },
        TEST_SECRET,
      );
      if (result.ok) {
        tokenValue = result.data.accessToken.value;
      }
    });

    it('should rotate a valid token and return a new one', () => {
      const result = rotateToken(tokenValue);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).not.toBeNull();
        expect(result.data!.value).not.toBe(tokenValue);
        expect(result.data!.scopes).toEqual(['read', 'write']);
        expect(result.data!.resources).toEqual(['svc:1']);
        expect(result.data!.clientId).toBe(TEST_CLIENT_ID);
      }
    });

    it('should invalidate the old token after rotation', () => {
      rotateToken(tokenValue);

      // Old token should no longer work
      const check = introspectToken(tokenValue);
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.data).toBeNull();
      }
    });

    it('should return null for nonexistent token', () => {
      const result = rotateToken('nonexistent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }
    });

    it('should return null for expired token', () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(7200_000); // 2 hours

      const result = rotateToken(tokenValue);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }

      vi.useRealTimers();
    });
  });

  // ── Scope Checking ──

  describe('hasScope', () => {
    function makeToken(scopes: ('read' | 'write' | 'admin')[]): AccessToken {
      return {
        value: 'test-token',
        scopes,
        clientId: 'test',
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
      };
    }

    it('should return true when token has the exact scope', () => {
      expect(hasScope(makeToken(['read']), 'read')).toBe(true);
      expect(hasScope(makeToken(['write']), 'write')).toBe(true);
      expect(hasScope(makeToken(['admin']), 'admin')).toBe(true);
    });

    it('should return false when token lacks the required scope', () => {
      expect(hasScope(makeToken(['read']), 'write')).toBe(false);
      expect(hasScope(makeToken(['read']), 'admin')).toBe(false);
    });

    it('should grant admin all scopes', () => {
      const adminToken = makeToken(['admin']);
      expect(hasScope(adminToken, 'read')).toBe(true);
      expect(hasScope(adminToken, 'write')).toBe(true);
      expect(hasScope(adminToken, 'admin')).toBe(true);
    });

    it('should grant write implies read', () => {
      const writeToken = makeToken(['write']);
      expect(hasScope(writeToken, 'read')).toBe(true);
      expect(hasScope(writeToken, 'write')).toBe(true);
      expect(hasScope(writeToken, 'admin')).toBe(false);
    });

    it('should work with multiple scopes', () => {
      const token = makeToken(['read', 'write']);
      expect(hasScope(token, 'read')).toBe(true);
      expect(hasScope(token, 'write')).toBe(true);
      expect(hasScope(token, 'admin')).toBe(false);
    });
  });

  // ── clearGnapStore ──

  describe('clearGnapStore', () => {
    it('should clear all tokens and clients', () => {
      registerClient(TEST_CLIENT_ID, TEST_SECRET);
      const grant = requestGrant(
        { client: TEST_CLIENT_ID, accessScopes: ['read'] },
        TEST_SECRET,
      );
      expect(grant.ok).toBe(true);

      clearGnapStore();

      // Client should no longer authenticate
      expect(authenticateClient(TEST_CLIENT_ID, TEST_SECRET)).toBe(false);

      // Token should be gone
      if (grant.ok) {
        const check = introspectToken(grant.data.accessToken.value);
        expect(check.ok).toBe(true);
        if (check.ok) {
          expect(check.data).toBeNull();
        }
      }
    });
  });
});

// ── GNAP Middleware ──

describe('GNAP Middleware — requireScope', () => {
  beforeEach(() => {
    clearGnapStore();
  });

  it('should allow a request with a valid GNAP token and sufficient scope', () => {
    registerClient(TEST_CLIENT_ID, TEST_SECRET);
    const grant = requestGrant(
      { client: TEST_CLIENT_ID, accessScopes: ['read', 'write'] },
      TEST_SECRET,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;

    const tokenValue = grant.data.accessToken.value;
    const req = createMockReq({ authorization: `Bearer ${tokenValue}` });
    const res = createMockRes();
    const next = createMockNext();

    const middleware = requireScope('read');
    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect((req as Request).gnapToken).toBeDefined();
    expect((req as Request).gnapToken!.value).toBe(tokenValue);
  });

  it('should reject a request with insufficient scope (403)', () => {
    registerClient(TEST_CLIENT_ID, TEST_SECRET);
    const grant = requestGrant(
      { client: TEST_CLIENT_ID, accessScopes: ['read'] },
      TEST_SECRET,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;

    const tokenValue = grant.data.accessToken.value;
    const req = createMockReq({ authorization: `Bearer ${tokenValue}` });
    const res = createMockRes();
    const next = createMockNext();

    const middleware = requireScope('admin');
    middleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      error: {
        code: 'INSUFFICIENT_SCOPE',
        message: 'Required scope: admin',
      },
    });
  });

  it('should fall back to API key auth when Bearer token is not a GNAP token', async () => {
    // Reset modules to get fresh config without an API key (dev mode)
    delete process.env.STATUSOWL_API_KEY;
    vi.resetModules();

    // Re-import after resetting modules to get fresh config
    const { requireScope: freshRequireScope } = await import('../src/auth/gnap-middleware.js');
    const { clearGnapStore: freshClear } = await import('../src/auth/gnap.js');
    freshClear();

    const req = createMockReq({ authorization: 'Bearer not-a-gnap-token' });
    const res = createMockRes();
    const next = createMockNext();

    const middleware = freshRequireScope('read');
    middleware(req as Request, res as Response, next);

    // In dev mode (no API key configured), requireAuth calls next()
    expect(next).toHaveBeenCalled();
  });

  it('should fall back to API key auth when no Authorization header is present', async () => {
    delete process.env.STATUSOWL_API_KEY;
    vi.resetModules();

    const { requireScope: freshRequireScope } = await import('../src/auth/gnap-middleware.js');

    const req = createMockReq({});
    const res = createMockRes();
    const next = createMockNext();

    const middleware = freshRequireScope('write');
    middleware(req as Request, res as Response, next);

    // Dev mode — no API key means auth is skipped, next() is called
    expect(next).toHaveBeenCalled();
  });

  it('should allow admin scope to satisfy any required scope via middleware', () => {
    registerClient(TEST_CLIENT_ID, TEST_SECRET);
    const grant = requestGrant(
      { client: TEST_CLIENT_ID, accessScopes: ['admin'] },
      TEST_SECRET,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;

    const tokenValue = grant.data.accessToken.value;

    // Should pass for 'read'
    const req1 = createMockReq({ authorization: `Bearer ${tokenValue}` });
    const res1 = createMockRes();
    const next1 = createMockNext();
    requireScope('read')(req1 as Request, res1 as Response, next1);
    expect(next1).toHaveBeenCalled();

    // Should pass for 'write'
    const req2 = createMockReq({ authorization: `Bearer ${tokenValue}` });
    const res2 = createMockRes();
    const next2 = createMockNext();
    requireScope('write')(req2 as Request, res2 as Response, next2);
    expect(next2).toHaveBeenCalled();

    // Should pass for 'admin'
    const req3 = createMockReq({ authorization: `Bearer ${tokenValue}` });
    const res3 = createMockRes();
    const next3 = createMockNext();
    requireScope('admin')(req3 as Request, res3 as Response, next3);
    expect(next3).toHaveBeenCalled();
  });

  it('should reject an expired GNAP token and fall back to API key auth', async () => {
    delete process.env.STATUSOWL_API_KEY;
    vi.resetModules();

    const { registerClient: reg, requestGrant: grant, clearGnapStore: clear } = await import('../src/auth/gnap.js');
    const { requireScope: freshRequireScope } = await import('../src/auth/gnap-middleware.js');
    clear();

    reg(TEST_CLIENT_ID, TEST_SECRET);
    const grantResult = grant(
      { client: TEST_CLIENT_ID, accessScopes: ['read'] },
      TEST_SECRET,
    );
    expect(grantResult.ok).toBe(true);
    if (!grantResult.ok) return;

    const tokenValue = grantResult.data.accessToken.value;

    // Advance time by 2 hours so the token is expired
    vi.useFakeTimers();
    vi.advanceTimersByTime(7200_000);

    const req = createMockReq({ authorization: `Bearer ${tokenValue}` });
    const res = createMockRes();
    const next = createMockNext();

    freshRequireScope('read')(req as Request, res as Response, next);

    // Token is expired, introspection returns null, so it falls back to API key auth.
    // In dev mode (no API key), requireAuth calls next().
    expect(next).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
