/**
 * Pagination Tests
 *
 * Tests for cursor-based pagination utilities and paginated service listing.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { encodeCursor, decodeCursor, buildPaginatedResponse } from '../src/api/pagination.js';
import { createService, listServicesPaginated } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateService } from '../src/core/index.js';

describe('Pagination Utilities', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('should roundtrip a cursor with a string sort value', () => {
      const cursor = encodeCursor('abc-123', '2025-01-15T10:00:00.000Z');
      const decoded = decodeCursor(cursor);

      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe('abc-123');
      expect(decoded!.sortValue).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should roundtrip a cursor with a numeric sort value', () => {
      const cursor = encodeCursor('id-456', 42);
      const decoded = decodeCursor(cursor);

      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe('id-456');
      expect(decoded!.sortValue).toBe(42);
    });

    it('should produce a base64url string without padding', () => {
      const cursor = encodeCursor('test-id', 'value');
      // base64url should not contain +, /, or = characters
      expect(cursor).not.toMatch(/[+/=]/);
    });
  });

  describe('decodeCursor with invalid input', () => {
    it('should return null for empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });

    it('should return null for garbage input', () => {
      expect(decodeCursor('not-valid-base64!!!')).toBeNull();
    });

    it('should return null for valid base64 but invalid JSON', () => {
      const encoded = Buffer.from('not json').toString('base64url');
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('should return null for valid JSON missing the id field', () => {
      const encoded = Buffer.from(JSON.stringify({ sortValue: 'test' })).toString('base64url');
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('should return null for valid JSON where id is not a string', () => {
      const encoded = Buffer.from(JSON.stringify({ id: 123, sortValue: 'test' })).toString('base64url');
      expect(decodeCursor(encoded)).toBeNull();
    });
  });

  describe('buildPaginatedResponse', () => {
    it('should return hasMore=false when items <= limit', () => {
      const items = [
        { id: '1', name: 'A', createdAt: '2025-01-01' },
        { id: '2', name: 'B', createdAt: '2025-01-02' },
      ];

      const result = buildPaginatedResponse(items, 5, (item) => item.createdAt);

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.cursor).toBeNull();
    });

    it('should return hasMore=true and trim when items > limit', () => {
      const items = [
        { id: '1', name: 'A', createdAt: '2025-01-01' },
        { id: '2', name: 'B', createdAt: '2025-01-02' },
        { id: '3', name: 'C', createdAt: '2025-01-03' },
      ];

      const result = buildPaginatedResponse(items, 2, (item) => item.createdAt);

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.cursor).not.toBeNull();

      // The cursor should encode the last returned item
      const decoded = decodeCursor(result.pagination.cursor!);
      expect(decoded!.id).toBe('2');
      expect(decoded!.sortValue).toBe('2025-01-02');
    });

    it('should handle empty array', () => {
      const result = buildPaginatedResponse([], 10, (item: { id: string }) => item.id);

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.cursor).toBeNull();
    });

    it('should include total when provided', () => {
      const items = [{ id: '1', createdAt: '2025-01-01' }];
      const result = buildPaginatedResponse(items, 10, (item) => item.createdAt, 42);

      expect(result.pagination.total).toBe(42);
    });

    it('should leave total undefined when not provided', () => {
      const items = [{ id: '1', createdAt: '2025-01-01' }];
      const result = buildPaginatedResponse(items, 10, (item) => item.createdAt);

      expect(result.pagination.total).toBeUndefined();
    });

    it('should handle exactly limit items (no extra)', () => {
      const items = [
        { id: '1', createdAt: '2025-01-01' },
        { id: '2', createdAt: '2025-01-02' },
        { id: '3', createdAt: '2025-01-03' },
      ];

      const result = buildPaginatedResponse(items, 3, (item) => item.createdAt);

      expect(result.data).toHaveLength(3);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.cursor).toBeNull();
    });
  });
});

describe('listServicesPaginated', () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear tables for isolation
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');
    db.exec('DELETE FROM service_groups');
  });

  function makeService(overrides: Partial<CreateService> = {}): CreateService {
    return {
      name: overrides.name ?? 'Test Service',
      url: overrides.url ?? 'https://example.com/health',
      ...overrides,
    };
  }

  it('should return all services when fewer than limit', () => {
    createService(makeService({ name: 'Svc A', url: 'https://a.example.com' }));
    createService(makeService({ name: 'Svc B', url: 'https://b.example.com' }));

    const result = listServicesPaginated({ limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toHaveLength(2);
    expect(result.data.total).toBe(2);
  });

  it('should return limit+1 rows for pagination detection', () => {
    // Create 5 services
    for (let i = 0; i < 5; i++) {
      createService(makeService({ name: `Svc ${i}`, url: `https://${i}.example.com` }));
    }

    const result = listServicesPaginated({ limit: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should return 4 rows (limit+1) so caller can detect hasMore
    expect(result.data.services).toHaveLength(4);
    expect(result.data.total).toBe(5);
  });

  it('should filter by enabled status', () => {
    createService(makeService({ name: 'Enabled', url: 'https://enabled.example.com', enabled: true }));
    createService(makeService({ name: 'Disabled', url: 'https://disabled.example.com', enabled: false }));

    const result = listServicesPaginated({ enabled: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toHaveLength(1);
    expect(result.data.services[0].name).toBe('Enabled');
    expect(result.data.total).toBe(1);
  });

  it('should filter by groupId', () => {
    // Create a group first
    const groupId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    db.prepare(`
      INSERT INTO service_groups (id, name, description, sort_order, collapsed)
      VALUES (?, 'Group A', 'Test group', 0, 0)
    `).run(groupId);

    createService(makeService({ name: 'Grouped', url: 'https://grouped.example.com', groupId }));
    createService(makeService({ name: 'Ungrouped', url: 'https://ungrouped.example.com' }));

    const result = listServicesPaginated({ groupId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toHaveLength(1);
    expect(result.data.services[0].name).toBe('Grouped');
    expect(result.data.total).toBe(1);
  });

  it('should paginate with cursor', () => {
    // Create services with distinct created_at times
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = createService(makeService({ name: `Svc ${i}`, url: `https://${i}.example.com` }));
      if (result.ok) ids.push(result.data.id);
    }

    // First page: limit=2
    const page1 = listServicesPaginated({ limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;

    // Should have 3 rows (limit+1)
    expect(page1.data.services).toHaveLength(3);
    expect(page1.data.total).toBe(5);

    // Use buildPaginatedResponse to get the cursor
    const page1Response = buildPaginatedResponse(
      page1.data.services,
      2,
      (s) => s.createdAt ?? '',
      page1.data.total,
    );
    expect(page1Response.pagination.hasMore).toBe(true);
    expect(page1Response.pagination.cursor).not.toBeNull();

    // Second page using cursor
    const page2 = listServicesPaginated({ limit: 2, cursor: page1Response.pagination.cursor! });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;

    // Should not overlap with page 1 data
    const page1Ids = page1Response.data.map((s) => s.id);
    const page2Ids = page2.data.services.map((s) => s.id);
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }
  });

  it('should return empty result when no services exist', () => {
    const result = listServicesPaginated({ limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toHaveLength(0);
    expect(result.data.total).toBe(0);
  });

  it('should combine multiple filters', () => {
    createService(makeService({ name: 'Enabled A', url: 'https://ea.example.com', enabled: true }));
    createService(makeService({ name: 'Disabled B', url: 'https://db.example.com', enabled: false }));
    createService(makeService({ name: 'Enabled C', url: 'https://ec.example.com', enabled: true }));

    // Filter to only enabled services
    const result = listServicesPaginated({ enabled: true, limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toHaveLength(2);
    expect(result.data.total).toBe(2);
    expect(result.data.services.every((s) => s.enabled)).toBe(true);
  });

  it('should handle invalid cursor gracefully (ignores it)', () => {
    createService(makeService({ name: 'Svc', url: 'https://example.com' }));

    // Pass a garbage cursor -- should be ignored and return all results
    const result = listServicesPaginated({ cursor: 'invalid-cursor-data', limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toHaveLength(1);
  });

  it('should use default limit of 20 when not specified', () => {
    // Create 25 services
    for (let i = 0; i < 25; i++) {
      createService(makeService({ name: `Svc ${i}`, url: `https://${i}.example.com` }));
    }

    const result = listServicesPaginated();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should get 21 rows (default limit 20 + 1)
    expect(result.data.services).toHaveLength(21);
    expect(result.data.total).toBe(25);
  });
});
