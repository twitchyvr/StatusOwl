/**
 * Audit Log Tests
 *
 * Tests for recordAudit, queryAuditLog, and purgeOldAuditEntries.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { recordAudit, queryAuditLog, purgeOldAuditEntries } from '../src/audit/audit-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';

describe('Audit Log Repository', () => {
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
    db.prepare('DELETE FROM audit_log').run();
  });

  describe('recordAudit', () => {
    it('should create an entry with correct fields', () => {
      const result = recordAudit('service.create', 'service', 'svc-123', {
        actor: 'admin',
        detail: 'Created test service',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.action).toBe('service.create');
      expect(result.data.resourceType).toBe('service');
      expect(result.data.resourceId).toBe('svc-123');
      expect(result.data.actor).toBe('admin');
      expect(result.data.detail).toBe('Created test service');
      expect(result.data.createdAt).toBeDefined();
    });

    it('should default actor to system', () => {
      const result = recordAudit('service.delete', 'service', 'svc-456');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.actor).toBe('system');
    });

    it('should default detail to null', () => {
      const result = recordAudit('group.create', 'group', 'grp-789');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.detail).toBeNull();
    });
  });

  describe('queryAuditLog', () => {
    it('should return all entries', () => {
      recordAudit('service.create', 'service', 'svc-1');
      recordAudit('group.create', 'group', 'grp-1');
      recordAudit('incident.create', 'incident', 'inc-1');

      const result = queryAuditLog();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries).toHaveLength(3);
      expect(result.data.total).toBe(3);
    });

    it('should filter by action', () => {
      recordAudit('service.create', 'service', 'svc-1');
      recordAudit('service.update', 'service', 'svc-1');
      recordAudit('group.create', 'group', 'grp-1');

      const result = queryAuditLog({ action: 'service.create' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries).toHaveLength(1);
      expect(result.data.entries[0].action).toBe('service.create');
      expect(result.data.total).toBe(1);
    });

    it('should filter by resourceType', () => {
      recordAudit('service.create', 'service', 'svc-1');
      recordAudit('service.update', 'service', 'svc-2');
      recordAudit('group.create', 'group', 'grp-1');

      const result = queryAuditLog({ resourceType: 'service' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries).toHaveLength(2);
      expect(result.data.entries.every(e => e.resourceType === 'service')).toBe(true);
      expect(result.data.total).toBe(2);
    });

    it('should filter by resourceId', () => {
      recordAudit('service.create', 'service', 'svc-1');
      recordAudit('service.update', 'service', 'svc-1');
      recordAudit('service.create', 'service', 'svc-2');

      const result = queryAuditLog({ resourceId: 'svc-1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries).toHaveLength(2);
      expect(result.data.entries.every(e => e.resourceId === 'svc-1')).toBe(true);
      expect(result.data.total).toBe(2);
    });

    it('should respect limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        recordAudit('service.create', 'service', `svc-${i}`);
      }

      const page1 = queryAuditLog({ limit: 3, offset: 0 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.data.entries).toHaveLength(3);
      expect(page1.data.total).toBe(10);

      const page2 = queryAuditLog({ limit: 3, offset: 3 });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.data.entries).toHaveLength(3);
      expect(page2.data.total).toBe(10);

      // Entries should not overlap
      const page1Ids = page1.data.entries.map(e => e.id);
      const page2Ids = page2.data.entries.map(e => e.id);
      const overlap = page1Ids.filter(id => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('should return total count', () => {
      for (let i = 0; i < 5; i++) {
        recordAudit('service.create', 'service', `svc-${i}`);
      }

      const result = queryAuditLog({ limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries).toHaveLength(2);
      expect(result.data.total).toBe(5);
    });

    it('should order by created_at descending', () => {
      // Insert with distinct timestamps to ensure deterministic ordering
      const now = Date.now();
      db.prepare(
        'INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('ord-1', 'service.create', 'service', 'svc-first', 'system', null, new Date(now - 3000).toISOString());
      db.prepare(
        'INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('ord-2', 'service.create', 'service', 'svc-second', 'system', null, new Date(now - 2000).toISOString());
      db.prepare(
        'INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('ord-3', 'service.create', 'service', 'svc-third', 'system', null, new Date(now - 1000).toISOString());

      const result = queryAuditLog();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Most recent should be first
      expect(result.data.entries[0].resourceId).toBe('svc-third');
      expect(result.data.entries[2].resourceId).toBe('svc-first');
    });
  });

  describe('purgeOldAuditEntries', () => {
    it('should remove old entries', () => {
      // Insert entries with old timestamps directly
      const oldDate = new Date(Date.now() - 100 * 86400_000).toISOString(); // 100 days ago
      db.prepare(
        'INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('old-1', 'service.create', 'service', 'svc-old-1', 'system', null, oldDate);
      db.prepare(
        'INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('old-2', 'service.create', 'service', 'svc-old-2', 'system', null, oldDate);

      // Insert a recent entry
      recordAudit('service.create', 'service', 'svc-recent');

      // Purge entries older than 90 days
      const purgeResult = purgeOldAuditEntries(90);
      expect(purgeResult.ok).toBe(true);
      if (!purgeResult.ok) return;
      expect(purgeResult.data).toBe(2);

      // Verify only recent entry remains
      const remaining = queryAuditLog();
      expect(remaining.ok).toBe(true);
      if (!remaining.ok) return;
      expect(remaining.data.entries).toHaveLength(1);
      expect(remaining.data.entries[0].resourceId).toBe('svc-recent');
    });

    it('should keep recent entries', () => {
      // Insert recent entries
      recordAudit('service.create', 'service', 'svc-1');
      recordAudit('service.create', 'service', 'svc-2');
      recordAudit('service.create', 'service', 'svc-3');

      // Purge entries older than 30 days (none should be purged)
      const purgeResult = purgeOldAuditEntries(30);
      expect(purgeResult.ok).toBe(true);
      if (!purgeResult.ok) return;
      expect(purgeResult.data).toBe(0);

      // All entries should remain
      const remaining = queryAuditLog();
      expect(remaining.ok).toBe(true);
      if (!remaining.ok) return;
      expect(remaining.data.entries).toHaveLength(3);
    });
  });
});
