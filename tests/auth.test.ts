/**
 * Auth Middleware Tests
 *
 * Tests for API key authentication middleware.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock request/response helpers
function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
  return {
    headers: headers,
  };
}

function createMockRes(): Partial<Response> & { statusCode: number; body: unknown } {
  const self = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
  };
  return self;
}

function createMockNext(): NextFunction {
  return vi.fn();
}

describe('Auth Middleware', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('when no API key is configured (dev mode)', () => {
    it('should call next() without API key (skip auth)', async () => {
      delete process.env.STATUSOWL_API_KEY;
      vi.resetModules();
      
      // Force fresh import after env change
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200); // Not called
    });
  });

  describe('when API key is configured', () => {
    const validApiKey = 'test-api-key-123';

    beforeEach(() => {
      process.env.STATUSOWL_API_KEY = validApiKey;
      vi.resetModules();
    });

    it('should return 401 when no API key provided', async () => {
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq({});
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key required. Provide it via Authorization: Bearer <key> or X-API-Key header.',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 with invalid API key', async () => {
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq({ authorization: 'Bearer wrong-key' });
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key.',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() with valid API key via Authorization Bearer', async () => {
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq({ authorization: `Bearer ${validApiKey}` });
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('should call next() with valid API key via X-API-Key header', async () => {
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq({ 'x-api-key': validApiKey });
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('should reject malformed Authorization header', async () => {
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq({ authorization: 'InvalidFormat' });
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject empty Bearer token', async () => {
      const { requireAuth: auth } = await import('../src/api/auth.js');
      
      const req = createMockReq({ authorization: 'Bearer' });
      const res = createMockRes();
      const next = createMockNext();

      auth(req as Request, res as Response, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('Config API Key', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should include apiKey in config schema', async () => {
    // Use dynamic import for ESM compatibility
    const { getConfig } = await import('../src/core/config.js');
    const config = getConfig();
    expect(config).toHaveProperty('apiKey');
  });
});
