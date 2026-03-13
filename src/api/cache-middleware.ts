/**
 * StatusOwl — HTTP Response Cache Middleware
 *
 * ETag/Last-Modified conditional caching with in-memory LRU store.
 * Handles If-None-Match and If-Modified-Since for 304 responses.
 * Automatically invalidates cache entries on mutation requests.
 */

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../core/index.js';

const log = createChildLogger('CacheMiddleware');

// ── Types ──

export interface CacheMiddlewareOptions {
  /** Maximum number of cached entries (default: 500) */
  maxEntries?: number;
  /** Default TTL in seconds (default: 60) */
  defaultTtlSeconds?: number;
  /** Cache-Control header value for GET responses (default: 'public, max-age=60') */
  cacheControl?: string;
  /** Route prefixes that share an invalidation group, keyed by group name.
   *  Mutation on any route in a group invalidates all cached entries in that group.
   *  Example: { services: ['/api/services', '/api/groups'] }
   */
  invalidationGroups?: Record<string, string[]>;
}

interface CacheEntry {
  etag: string;
  lastModified: string;
  body: string;
  statusCode: number;
  headers: Record<string, string>;
  createdAt: number;
  ttlMs: number;
  /** Which invalidation groups this entry belongs to */
  groups: string[];
}

export interface CacheStats {
  /** Total entries currently stored */
  size: number;
  /** Maximum allowed entries */
  maxEntries: number;
  /** Total cache hits (304 returned) */
  hits: number;
  /** Total cache misses (full response sent) */
  misses: number;
  /** Total entries evicted via LRU */
  evictions: number;
  /** Total entries removed via invalidation */
  invalidations: number;
  /** Hit rate as a percentage (0-100) */
  hitRate: number;
}

// ── LRU Cache Implementation ──

/**
 * Doubly-linked-list node for LRU ordering.
 * Most-recently-used at the head, least-recently-used at the tail.
 */
interface LruNode {
  key: string;
  prev: LruNode | null;
  next: LruNode | null;
}

class LruCache {
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry>();
  private readonly order = new Map<string, LruNode>();
  private head: LruNode | null = null;
  private tail: LruNode | null = null;

  /** Running counters for stats */
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _invalidations = 0;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  // ── Public API ──

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.delete(key);
      this._misses++;
      return undefined;
    }

    // Promote to head (most recently used)
    this.promote(key);
    this._hits++;
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    // If the key already exists, update in place and promote
    if (this.store.has(key)) {
      this.store.set(key, entry);
      this.promote(key);
      return;
    }

    // Evict LRU entries if at capacity
    while (this.store.size >= this.maxEntries && this.tail) {
      this.evictTail();
    }

    // Insert new entry
    this.store.set(key, entry);
    this.addToHead(key);
  }

  delete(key: string): boolean {
    if (!this.store.has(key)) return false;
    this.store.delete(key);
    this.removeNode(key);
    return true;
  }

  /**
   * Invalidate all entries whose keys match the given URL path pattern
   * or that belong to any of the specified invalidation groups.
   * Cache keys are stored as "METHOD:/path", so the pattern is matched
   * against the path portion after the method prefix.
   */
  invalidateByPattern(pattern: string, groups: string[] = []): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.store) {
      // Extract the URL path from the cache key (strip "METHOD:" prefix)
      const colonIndex = key.indexOf(':');
      const keyPath = colonIndex >= 0 ? key.substring(colonIndex + 1) : key;

      // Match by URL prefix
      if (keyPath.startsWith(pattern)) {
        keysToDelete.push(key);
        continue;
      }
      // Match by group membership
      if (groups.length > 0 && entry.groups.some(g => groups.includes(g))) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
      count++;
    }

    this._invalidations += count;
    return count;
  }

  clear(): void {
    this.store.clear();
    this.order.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.store.size;
  }

  get stats(): {
    hits: number;
    misses: number;
    evictions: number;
    invalidations: number;
  } {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      invalidations: this._invalidations,
    };
  }

  // ── Internal linked-list operations ──

  private addToHead(key: string): void {
    const node: LruNode = { key, prev: null, next: this.head };
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
    this.order.set(key, node);
  }

  private removeNode(key: string): void {
    const node = this.order.get(key);
    if (!node) return;

    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    this.order.delete(key);
  }

  private promote(key: string): void {
    const node = this.order.get(key);
    if (!node || node === this.head) return;
    this.removeNode(key);
    this.addToHead(key);
  }

  private evictTail(): void {
    if (!this.tail) return;
    const evictedKey = this.tail.key;
    this.delete(evictedKey);
    this._evictions++;
  }
}

// ── Module-level cache instance ──

let cache: LruCache | null = null;
let cacheOptions: Required<CacheMiddlewareOptions> | null = null;

function getCache(): LruCache {
  if (!cache) {
    cache = new LruCache(500);
    cacheOptions = {
      maxEntries: 500,
      defaultTtlSeconds: 60,
      cacheControl: 'public, max-age=60',
      invalidationGroups: {},
    };
  }
  return cache;
}

function getOptions(): Required<CacheMiddlewareOptions> {
  if (!cacheOptions) {
    getCache(); // initializes options
  }
  return cacheOptions!;
}

// ── ETag generation ──

/**
 * Generate a weak ETag from a response body using MD5.
 * Uses the W/ prefix per RFC 7232 to indicate semantic equivalence.
 */
export function generateETag(body: string): string {
  const hash = createHash('md5').update(body).digest('hex');
  return `W/"${hash}"`;
}

// ── Helpers ──

/**
 * Build a cache key from the request.
 * Uses method + original URL (includes query string).
 */
function buildCacheKey(req: Request): string {
  return `${req.method}:${req.originalUrl}`;
}

/**
 * Determine which invalidation groups a given URL path belongs to.
 */
function resolveGroups(path: string, groups: Record<string, string[]>): string[] {
  const matched: string[] = [];
  for (const [groupName, prefixes] of Object.entries(groups)) {
    if (prefixes.some(prefix => path.startsWith(prefix))) {
      matched.push(groupName);
    }
  }
  return matched;
}

/**
 * Find all group names that should be invalidated when a mutation
 * hits the given path.
 */
function findGroupsToInvalidate(path: string, groups: Record<string, string[]>): string[] {
  return resolveGroups(path, groups);
}

// ── Middleware factory ──

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Create the HTTP caching middleware.
 *
 * For GET/HEAD requests:
 *   - Checks If-None-Match / If-Modified-Since and returns 304 when valid.
 *   - Caches the response body, ETag, and Last-Modified for future requests.
 *
 * For POST/PATCH/PUT/DELETE requests:
 *   - Invalidates cached entries that share the same route prefix or
 *     invalidation group, then passes through without caching.
 */
export function cacheMiddleware(
  options: CacheMiddlewareOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const maxEntries = options.maxEntries ?? 500;
  const defaultTtlSeconds = options.defaultTtlSeconds ?? 60;
  const cacheControl = options.cacheControl ?? 'public, max-age=60';
  const invalidationGroups = options.invalidationGroups ?? {};

  // Initialize (or re-initialize) the module-level cache
  cache = new LruCache(maxEntries);
  cacheOptions = {
    maxEntries,
    defaultTtlSeconds,
    cacheControl,
    invalidationGroups,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const lru = getCache();

    // ── Mutation: invalidate and pass through ──
    if (MUTATION_METHODS.has(req.method)) {
      const basePath = extractBasePath(req.originalUrl);
      const groups = findGroupsToInvalidate(basePath, invalidationGroups);
      const count = lru.invalidateByPattern(basePath, groups);
      if (count > 0) {
        log.debug({ path: basePath, count }, 'Cache invalidated on mutation');
      }
      next();
      return;
    }

    // ── Only cache GET requests ──
    if (req.method !== 'GET') {
      next();
      return;
    }

    const cacheKey = buildCacheKey(req);
    const cached = lru.get(cacheKey);

    if (cached) {
      // ── Conditional: If-None-Match ──
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === cached.etag) {
        res.status(304).end();
        return;
      }

      // ── Conditional: If-Modified-Since ──
      const ifModifiedSince = req.headers['if-modified-since'];
      if (ifModifiedSince) {
        const clientDate = new Date(ifModifiedSince).getTime();
        const serverDate = new Date(cached.lastModified).getTime();
        if (!isNaN(clientDate) && !isNaN(serverDate) && serverDate <= clientDate) {
          res.status(304).end();
          return;
        }
      }

      // ── Cache hit: serve from cache ──
      for (const [header, value] of Object.entries(cached.headers)) {
        res.setHeader(header, value);
      }
      res.setHeader('ETag', cached.etag);
      res.setHeader('Last-Modified', cached.lastModified);
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('X-Cache', 'HIT');
      res.status(cached.statusCode).send(cached.body);
      return;
    }

    // ── Cache miss: intercept the response to capture it ──
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const captureAndCache = (body: string, statusCode: number): void => {
      // Only cache successful responses (2xx)
      if (statusCode < 200 || statusCode >= 300) return;

      const etag = generateETag(body);
      const lastModified = new Date().toUTCString();
      const basePath = extractBasePath(req.originalUrl);
      const groups = resolveGroups(basePath, invalidationGroups);

      const entry: CacheEntry = {
        etag,
        lastModified,
        body,
        statusCode,
        headers: {
          'Content-Type': res.getHeader('content-type') as string || 'application/json',
        },
        createdAt: Date.now(),
        ttlMs: defaultTtlSeconds * 1000,
        groups,
      };

      lru.set(cacheKey, entry);

      // Set cache headers on the outgoing response
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified);
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('X-Cache', 'MISS');
    };

    // Override res.json to capture JSON responses
    res.json = function cacheInterceptJson(data: unknown): Response {
      const bodyStr = JSON.stringify(data);
      captureAndCache(bodyStr, res.statusCode);
      return originalJson(data);
    };

    // Override res.send to capture string/Buffer responses
    res.send = function cacheInterceptSend(data: unknown): Response {
      if (typeof data === 'string') {
        captureAndCache(data, res.statusCode);
      } else if (Buffer.isBuffer(data)) {
        captureAndCache(data.toString('utf-8'), res.statusCode);
      }
      return originalSend(data);
    };

    next();
  };
}

// ── Public utilities ──

/**
 * Invalidate all cache entries whose keys match the given pattern (prefix).
 * Also invalidates entries in any matching invalidation group.
 *
 * @param pattern - URL prefix to match (e.g. '/api/services')
 * @returns Number of entries invalidated
 */
export function invalidateCache(pattern: string): number {
  const lru = getCache();
  const opts = getOptions();
  const groups = findGroupsToInvalidate(pattern, opts.invalidationGroups);
  const count = lru.invalidateByPattern(pattern, groups);
  if (count > 0) {
    log.debug({ pattern, count }, 'Cache manually invalidated');
  }
  return count;
}

/**
 * Get current cache statistics.
 */
export function getCacheStats(): CacheStats {
  const lru = getCache();
  const opts = getOptions();
  const { hits, misses, evictions, invalidations } = lru.stats;
  const total = hits + misses;

  return {
    size: lru.size,
    maxEntries: opts.maxEntries,
    hits,
    misses,
    evictions,
    invalidations,
    hitRate: total > 0 ? Math.round((hits / total) * 10000) / 100 : 0,
  };
}

/**
 * Reset the cache (primarily for testing).
 */
export function resetCache(): void {
  if (cache) {
    cache.clear();
  }
  cache = null;
  cacheOptions = null;
}

// ── Internal helpers ──

/**
 * Extract the base path from a URL, stripping the query string
 * and any trailing UUID-like segments for broader invalidation matching.
 *
 * Example: '/api/services/abc-123?limit=10' -> '/api/services'
 */
function extractBasePath(url: string): string {
  // Strip query string
  const pathOnly = url.split('?')[0];

  // Remove trailing path segments that look like UUIDs or IDs
  // so that a DELETE to /api/services/abc-123 invalidates /api/services/*
  const segments = pathOnly.split('/').filter(Boolean);
  const baseSegments: string[] = [];

  for (const segment of segments) {
    // Stop at segments that look like UUIDs or numeric IDs
    if (isIdSegment(segment)) {
      break;
    }
    baseSegments.push(segment);
  }

  return '/' + baseSegments.join('/');
}

/**
 * Known API sub-resource segments that are NOT IDs.
 * These appear after a resource name and represent nested collections/actions,
 * not individual resource identifiers.
 */
const KNOWN_SUB_RESOURCES = new Set([
  'api', 'v2', 'checks', 'uptime', 'history', 'ssl', 'percentiles',
  'dependencies', 'dependents', 'downstream', 'incidents', 'update',
  'alert-policy', 'alert-policies', 'calendar', 'health-score', 'sla',
  'sla-targets', 'regional-latency', 'deliveries', 'retry', 'events',
  'stats', 'badge', 'embed', 'widget', 'reports', 'generate',
  'audit-log', 'subscriptions', 'confirm', 'unsubscribe', 'regions',
  'maintenance-windows', 'webhooks', 'services', 'groups', 'branding',
  'status', 'auth', 'register', 'grant', 'introspect', 'revoke', 'rotate',
]);

/**
 * Heuristic: does this path segment look like a resource ID?
 *
 * Returns true for:
 *  - UUID format (e.g. '550e8400-e29b-41d4-a716-446655440000')
 *  - Pure numeric (e.g. '42')
 *  - Any segment that is NOT a known sub-resource keyword
 *    (catches short IDs like 'abc-123', 'some-id', etc.)
 */
function isIdSegment(segment: string): boolean {
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  // Pure numeric
  if (/^\d+$/.test(segment)) {
    return true;
  }
  // If it's not a known sub-resource name, treat it as an ID
  if (!KNOWN_SUB_RESOURCES.has(segment.toLowerCase())) {
    return true;
  }
  return false;
}
