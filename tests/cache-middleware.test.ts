/**
 * Cache Middleware Tests
 *
 * Tests for HTTP response caching with ETag, Last-Modified,
 * LRU eviction, TTL expiry, cache invalidation, and stats.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import {
  cacheMiddleware,
  generateETag,
  invalidateCache,
  getCacheStats,
  resetCache,
} from '../src/api/cache-middleware.js';

// Mock the logger to suppress output in tests
vi.mock('../src/core/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
  getLogger: () => ({
    level: 'error',
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

// Mock config (required by logger import chain)
vi.mock('../src/core/config.js', () => ({
  getConfig: () => ({
    logLevel: 'error',
    dbPath: ':memory:',
    port: 3000,
    siteName: 'StatusOwl',
    siteDescription: '',
    primaryColor: '#4f46e5',
    accentColor: '#10b981',
  }),
  loadConfig: vi.fn(),
}));

/**
 * Helper: create a fresh Express app with the cache middleware
 * and a test endpoint.
 */
function createTestApp(
  options: Parameters<typeof cacheMiddleware>[0] = {},
  responseData: Record<string, unknown> = { ok: true, data: { id: '1', name: 'Test' } },
  statusCode = 200,
): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());
  app.use(cacheMiddleware(options));

  // GET endpoint
  app.get('/api/services', (_req: Request, res: Response) => {
    res.status(statusCode).json(responseData);
  });

  app.get('/api/services/:id', (req: Request, res: Response) => {
    res.status(statusCode).json({ ok: true, data: { id: req.params.id, name: 'Service' } });
  });

  app.get('/api/groups', (_req: Request, res: Response) => {
    res.status(statusCode).json({ ok: true, data: [{ id: 'g1', name: 'Group 1' }] });
  });

  // Mutation endpoints
  app.post('/api/services', (req: Request, res: Response) => {
    res.status(201).json({ ok: true, data: { id: 'new-1', ...req.body } });
  });

  app.patch('/api/services/:id', (req: Request, res: Response) => {
    res.status(200).json({ ok: true, data: { id: req.params.id, ...req.body } });
  });

  app.delete('/api/services/:id', (req: Request, res: Response) => {
    res.status(200).json({ ok: true, data: { deleted: true } });
  });

  // Error endpoint (4xx should not be cached)
  app.get('/api/error', (_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}

describe('Cache Middleware', () => {
  beforeEach(() => {
    resetCache();
  });

  afterEach(() => {
    resetCache();
  });

  // ── ETag Generation ──

  describe('generateETag', () => {
    it('should produce a weak ETag string from body content', () => {
      const body = JSON.stringify({ ok: true, data: 'hello' });
      const etag = generateETag(body);

      expect(etag).toMatch(/^W\/"[a-f0-9]{32}"$/);
    });

    it('should produce the same ETag for the same body', () => {
      const body = JSON.stringify({ ok: true, data: [1, 2, 3] });
      const etag1 = generateETag(body);
      const etag2 = generateETag(body);

      expect(etag1).toBe(etag2);
    });

    it('should produce different ETags for different bodies', () => {
      const etag1 = generateETag('{"a":1}');
      const etag2 = generateETag('{"a":2}');

      expect(etag1).not.toBe(etag2);
    });

    it('should handle empty string body', () => {
      const etag = generateETag('');
      expect(etag).toMatch(/^W\/"[a-f0-9]{32}"$/);
    });
  });

  // ── Basic Caching Behavior ──

  describe('basic caching', () => {
    it('should set ETag, Last-Modified, Cache-Control on first request (cache miss)', async () => {
      const app = createTestApp();

      const res = await request(app).get('/api/services');

      expect(res.status).toBe(200);
      expect(res.headers['etag']).toMatch(/^W\/"[a-f0-9]{32}"$/);
      expect(res.headers['last-modified']).toBeDefined();
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.headers['x-cache']).toBe('MISS');
    });

    it('should return X-Cache: HIT on second request for same URL', async () => {
      const app = createTestApp();

      // First request: cache miss
      await request(app).get('/api/services');

      // Second request: cache hit
      const res = await request(app).get('/api/services');

      expect(res.status).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['last-modified']).toBeDefined();
    });

    it('should use custom Cache-Control header when specified', async () => {
      const app = createTestApp({ cacheControl: 'private, max-age=300' });

      const res = await request(app).get('/api/services');

      expect(res.headers['cache-control']).toBe('private, max-age=300');
    });

    it('should not cache non-2xx responses', async () => {
      const app = createTestApp({}, { ok: true, data: 'test' }, 200);

      // Request to error endpoint
      const res1 = await request(app).get('/api/error');
      expect(res1.status).toBe(404);

      // Stats should show no entries cached for the error
      const stats = getCacheStats();
      // Only the error request happened, and it should not be cached
      // (misses counter may be 0 because the response is captured but not stored)
      expect(stats.size).toBe(0);
    });

    it('should cache different URLs independently', async () => {
      const app = createTestApp();

      await request(app).get('/api/services');
      await request(app).get('/api/groups');

      const stats = getCacheStats();
      expect(stats.size).toBe(2);
    });

    it('should return the same response body on cache hit', async () => {
      const responseData = { ok: true, data: { id: '1', name: 'Cached Service' } };
      const app = createTestApp({}, responseData);

      const res1 = await request(app).get('/api/services');
      const res2 = await request(app).get('/api/services');

      expect(res1.body).toEqual(responseData);
      expect(res2.body).toEqual(responseData);
    });
  });

  // ── 304 Not Modified (If-None-Match) ──

  describe('conditional requests — If-None-Match', () => {
    it('should return 304 when If-None-Match matches the cached ETag', async () => {
      const app = createTestApp();

      // Prime the cache
      const first = await request(app).get('/api/services');
      const etag = first.headers['etag'];

      // Conditional request
      const res = await request(app)
        .get('/api/services')
        .set('If-None-Match', etag);

      expect(res.status).toBe(304);
      expect(res.body).toEqual({});
    });

    it('should return 200 when If-None-Match does not match', async () => {
      const app = createTestApp();

      // Prime the cache
      await request(app).get('/api/services');

      // Conditional request with wrong ETag
      const res = await request(app)
        .get('/api/services')
        .set('If-None-Match', 'W/"0000000000000000"');

      expect(res.status).toBe(200);
    });

    it('should return 200 on first request even with If-None-Match header', async () => {
      const app = createTestApp();

      // Send If-None-Match without priming (no cache entry)
      const res = await request(app)
        .get('/api/services')
        .set('If-None-Match', 'W/"anything"');

      expect(res.status).toBe(200);
    });
  });

  // ── 304 Not Modified (If-Modified-Since) ──

  describe('conditional requests — If-Modified-Since', () => {
    it('should return 304 when If-Modified-Since is after Last-Modified', async () => {
      const app = createTestApp();

      // Prime the cache
      const first = await request(app).get('/api/services');
      const lastModified = first.headers['last-modified'];

      // Use a date in the future
      const futureDate = new Date(Date.now() + 60_000).toUTCString();

      const res = await request(app)
        .get('/api/services')
        .set('If-Modified-Since', futureDate);

      expect(res.status).toBe(304);
    });

    it('should return 304 when If-Modified-Since equals Last-Modified', async () => {
      const app = createTestApp();

      // Prime the cache
      const first = await request(app).get('/api/services');
      const lastModified = first.headers['last-modified'];

      const res = await request(app)
        .get('/api/services')
        .set('If-Modified-Since', lastModified);

      expect(res.status).toBe(304);
    });

    it('should return 200 when If-Modified-Since is before Last-Modified', async () => {
      const app = createTestApp();

      // Prime the cache
      await request(app).get('/api/services');

      // Use a date far in the past
      const pastDate = new Date('2020-01-01').toUTCString();

      const res = await request(app)
        .get('/api/services')
        .set('If-Modified-Since', pastDate);

      expect(res.status).toBe(200);
    });

    it('should ignore invalid If-Modified-Since dates', async () => {
      const app = createTestApp();

      // Prime the cache
      await request(app).get('/api/services');

      const res = await request(app)
        .get('/api/services')
        .set('If-Modified-Since', 'not-a-date');

      // Invalid date should not trigger 304, should serve from cache
      expect(res.status).toBe(200);
    });
  });

  // ── If-None-Match takes precedence over If-Modified-Since ──

  describe('conditional request precedence', () => {
    it('should check If-None-Match before If-Modified-Since', async () => {
      const app = createTestApp();

      // Prime the cache
      const first = await request(app).get('/api/services');
      const etag = first.headers['etag'];

      // Both headers present, ETag matches -> 304 regardless of date
      const res = await request(app)
        .get('/api/services')
        .set('If-None-Match', etag)
        .set('If-Modified-Since', 'Mon, 01 Jan 2020 00:00:00 GMT');

      expect(res.status).toBe(304);
    });
  });

  // ── LRU Eviction ──

  describe('LRU eviction', () => {
    it('should evict the least-recently-used entry when cache is full', async () => {
      const app = createTestApp({ maxEntries: 3 });

      // Fill cache to capacity
      await request(app).get('/api/services');
      await request(app).get('/api/services/1');
      await request(app).get('/api/services/2');

      const statsBefore = getCacheStats();
      expect(statsBefore.size).toBe(3);

      // One more should evict the oldest (GET:/api/services)
      await request(app).get('/api/groups');

      const statsAfter = getCacheStats();
      expect(statsAfter.size).toBe(3);
      expect(statsAfter.evictions).toBeGreaterThanOrEqual(1);
    });

    it('should keep most-recently-used entries on eviction', async () => {
      const app = createTestApp({ maxEntries: 2 });

      // Add two entries
      await request(app).get('/api/services');
      await request(app).get('/api/services/1');

      // Access the first one again (promotes it)
      await request(app).get('/api/services');

      // Add a third — should evict /api/services/1 (LRU)
      await request(app).get('/api/groups');

      // /api/services should still be cached (was promoted)
      const res = await request(app).get('/api/services');
      expect(res.headers['x-cache']).toBe('HIT');

      // /api/services/1 should have been evicted
      const res2 = await request(app).get('/api/services/1');
      expect(res2.headers['x-cache']).toBe('MISS');
    });

    it('should respect maxEntries of 1', async () => {
      const app = createTestApp({ maxEntries: 1 });

      await request(app).get('/api/services');
      expect(getCacheStats().size).toBe(1);

      await request(app).get('/api/groups');
      expect(getCacheStats().size).toBe(1);
      expect(getCacheStats().evictions).toBe(1);
    });
  });

  // ── TTL Expiry ──

  describe('TTL expiry', () => {
    it('should expire cache entries after TTL', async () => {
      // Use a very short TTL
      const app = createTestApp({ defaultTtlSeconds: 1 });

      // Prime the cache
      await request(app).get('/api/services');
      expect(getCacheStats().size).toBe(1);

      // Manually mock Date.now to simulate time passing
      const realDateNow = Date.now;
      try {
        const baseTime = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2000); // 2 seconds later

        // This should be a miss because the entry expired
        const res = await request(app).get('/api/services');
        expect(res.headers['x-cache']).toBe('MISS');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should serve from cache before TTL expires', async () => {
      const app = createTestApp({ defaultTtlSeconds: 3600 }); // 1 hour

      await request(app).get('/api/services');

      // Advance time by 30 minutes (still within TTL)
      const realDateNow = Date.now;
      try {
        const baseTime = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(baseTime + 30 * 60 * 1000);

        const res = await request(app).get('/api/services');
        expect(res.headers['x-cache']).toBe('HIT');
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  // ── Cache Invalidation on Mutations ──

  describe('cache invalidation on mutations', () => {
    it('should invalidate cache when POST request hits the same route prefix', async () => {
      const app = createTestApp();

      // Prime cache
      await request(app).get('/api/services');
      expect(getCacheStats().size).toBe(1);

      // POST to /api/services should invalidate the cached GET
      await request(app)
        .post('/api/services')
        .send({ name: 'New Service', url: 'https://example.com' });

      // GET should be a miss now
      const res = await request(app).get('/api/services');
      expect(res.headers['x-cache']).toBe('MISS');
    });

    it('should invalidate cache when PATCH request hits a related route', async () => {
      const app = createTestApp();

      // Prime cache
      await request(app).get('/api/services');
      expect(getCacheStats().size).toBe(1);

      // PATCH to /api/services/123 should invalidate /api/services
      await request(app)
        .patch('/api/services/abc-def')
        .send({ name: 'Updated' });

      const res = await request(app).get('/api/services');
      expect(res.headers['x-cache']).toBe('MISS');
    });

    it('should invalidate cache when DELETE request hits a related route', async () => {
      const app = createTestApp();

      // Prime cache
      await request(app).get('/api/services');

      // DELETE /api/services/123
      await request(app).delete('/api/services/some-id');

      const res = await request(app).get('/api/services');
      expect(res.headers['x-cache']).toBe('MISS');
    });

    it('should not invalidate unrelated routes on mutation', async () => {
      const app = createTestApp();

      // Prime cache for both routes
      await request(app).get('/api/services');
      await request(app).get('/api/groups');
      expect(getCacheStats().size).toBe(2);

      // POST to /api/services should NOT invalidate /api/groups
      await request(app)
        .post('/api/services')
        .send({ name: 'New' });

      const res = await request(app).get('/api/groups');
      expect(res.headers['x-cache']).toBe('HIT');
    });
  });

  // ── Invalidation Groups ──

  describe('invalidation groups', () => {
    it('should invalidate all routes in the same group on mutation', async () => {
      const app = createTestApp({
        invalidationGroups: {
          catalog: ['/api/services', '/api/groups'],
        },
      });

      // Prime cache for both routes
      await request(app).get('/api/services');
      await request(app).get('/api/groups');
      expect(getCacheStats().size).toBe(2);

      // POST to /api/services should also invalidate /api/groups (same group)
      await request(app)
        .post('/api/services')
        .send({ name: 'New' });

      const resServices = await request(app).get('/api/services');
      const resGroups = await request(app).get('/api/groups');

      expect(resServices.headers['x-cache']).toBe('MISS');
      expect(resGroups.headers['x-cache']).toBe('MISS');
    });
  });

  // ── Manual Invalidation via invalidateCache() ──

  describe('invalidateCache()', () => {
    it('should invalidate entries matching the given pattern', async () => {
      const app = createTestApp();

      await request(app).get('/api/services');
      await request(app).get('/api/groups');
      expect(getCacheStats().size).toBe(2);

      const count = invalidateCache('/api/services');
      expect(count).toBeGreaterThanOrEqual(1);
      expect(getCacheStats().size).toBe(1);
    });

    it('should return 0 when no entries match the pattern', () => {
      const count = invalidateCache('/api/nonexistent');
      expect(count).toBe(0);
    });
  });

  // ── Cache Stats ──

  describe('getCacheStats()', () => {
    it('should report accurate size, hits, and misses', async () => {
      const app = createTestApp();

      // 1 miss
      await request(app).get('/api/services');

      // 1 hit
      await request(app).get('/api/services');

      const stats = getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.maxEntries).toBe(500);
    });

    it('should report eviction count', async () => {
      const app = createTestApp({ maxEntries: 1 });

      await request(app).get('/api/services');
      await request(app).get('/api/groups'); // evicts /api/services

      const stats = getCacheStats();
      expect(stats.evictions).toBe(1);
    });

    it('should report invalidation count', async () => {
      const app = createTestApp();

      await request(app).get('/api/services');
      invalidateCache('/api/services');

      const stats = getCacheStats();
      expect(stats.invalidations).toBe(1);
    });

    it('should report hit rate correctly', async () => {
      const app = createTestApp();

      // 1 miss + 3 hits = 75% hit rate
      await request(app).get('/api/services');
      await request(app).get('/api/services');
      await request(app).get('/api/services');
      await request(app).get('/api/services');

      const stats = getCacheStats();
      expect(stats.hitRate).toBe(75);
    });

    it('should report 0 hit rate when no requests made', () => {
      // Initialize cache by creating app with middleware
      createTestApp();
      const stats = getCacheStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.size).toBe(0);
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle requests with query strings as separate cache keys', async () => {
      const app = createTestApp();

      await request(app).get('/api/services?limit=10');
      await request(app).get('/api/services?limit=20');

      expect(getCacheStats().size).toBe(2);
    });

    it('should not cache HEAD requests', async () => {
      const app = createTestApp();

      await request(app).head('/api/services');

      expect(getCacheStats().size).toBe(0);
    });

    it('should pass through PUT requests without caching', async () => {
      const app = express();
      app.use(express.json());
      app.use(cacheMiddleware());

      app.put('/api/services/:id', (req: Request, res: Response) => {
        res.json({ ok: true, data: { updated: true } });
      });

      const res = await request(app)
        .put('/api/services/1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(getCacheStats().size).toBe(0);
    });

    it('should update cached entry when same URL is fetched after invalidation', async () => {
      let callCount = 0;
      const app = express();
      app.use(express.json());
      app.use(cacheMiddleware());

      app.get('/api/counter', (_req: Request, res: Response) => {
        callCount++;
        res.json({ ok: true, data: { count: callCount } });
      });

      app.post('/api/counter', (_req: Request, res: Response) => {
        res.status(201).json({ ok: true });
      });

      // First request: callCount = 1
      const res1 = await request(app).get('/api/counter');
      expect(res1.body.data.count).toBe(1);

      // Second request: served from cache, still 1
      const res2 = await request(app).get('/api/counter');
      expect(res2.body.data.count).toBe(1);
      expect(res2.headers['x-cache']).toBe('HIT');

      // Mutation invalidates
      await request(app).post('/api/counter').send({});

      // Third request: cache miss, handler runs again, callCount = 2
      const res3 = await request(app).get('/api/counter');
      expect(res3.body.data.count).toBe(2);
      expect(res3.headers['x-cache']).toBe('MISS');
    });
  });

  // ── resetCache() ──

  describe('resetCache()', () => {
    it('should clear all entries and reset state', async () => {
      const app = createTestApp();

      await request(app).get('/api/services');
      await request(app).get('/api/groups');
      expect(getCacheStats().size).toBe(2);

      resetCache();

      // After reset, getCacheStats initializes a fresh cache
      const stats = getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });
});
