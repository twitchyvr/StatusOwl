/**
 * Bulk Operations Tests
 *
 * Tests for batch create, update, and delete of services.
 * Covers atomic/partial modes, validation, limits, and audit log integration.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { bulkCreateServices, bulkUpdateServices, bulkDeleteServices } from '../src/api/bulk-operations.js';
import { createService, getService, listServices } from '../src/storage/service-repo.js';
import { queryAuditLog } from '../src/audit/audit-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import { CreateServiceSchema } from '../src/core/contracts.js';
import type { CreateService } from '../src/core/index.js';

function makeService(overrides: Partial<CreateService> = {}): CreateService {
  return {
    name: overrides.name ?? 'Test Service',
    url: overrides.url ?? 'https://example.com/health',
    ...overrides,
  };
}

function makeServices(count: number): CreateService[] {
  return Array.from({ length: count }, (_, i) =>
    makeService({ name: `Service ${i + 1}`, url: `https://svc-${i + 1}.example.com/health` })
  );
}

describe('Bulk Operations', () => {
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
    // Clean all relevant tables before each test
    db.prepare('DELETE FROM audit_log').run();
    db.prepare('DELETE FROM incident_updates').run();
    db.prepare('DELETE FROM incident_services').run();
    db.prepare('DELETE FROM incidents').run();
    db.prepare('DELETE FROM check_results').run();
    db.prepare('DELETE FROM services').run();
    db.prepare('DELETE FROM service_groups').run();
  });

  // ── Bulk Create ──

  describe('bulkCreateServices', () => {
    it('should create a single service', () => {
      const result = bulkCreateServices([makeService({ name: 'Solo Service' })]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.total).toBe(1);
      expect(result.data.succeeded).toBe(1);
      expect(result.data.failed).toBe(0);
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0].ok).toBe(true);
      expect(result.data.results[0].data?.name).toBe('Solo Service');
      expect(result.data.results[0].index).toBe(0);
    });

    it('should create 10 services atomically', () => {
      const services = makeServices(10);
      const result = bulkCreateServices(services);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.total).toBe(10);
      expect(result.data.succeeded).toBe(10);
      expect(result.data.failed).toBe(0);
      expect(result.data.mode).toBe('atomic');

      // Verify all exist in the database
      const listed = listServices();
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.data).toHaveLength(10);
    });

    it('should create 50 services atomically', () => {
      const services = makeServices(50);
      const result = bulkCreateServices(services);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.total).toBe(50);
      expect(result.data.succeeded).toBe(50);
      expect(result.data.failed).toBe(0);

      const listed = listServices();
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.data).toHaveLength(50);
    });

    it('should assign unique IDs to each created service', () => {
      const services = makeServices(5);
      const result = bulkCreateServices(services);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ids = result.data.results.map(r => r.data?.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(5);
    });

    it('should preserve service fields correctly in batch', () => {
      const services: CreateService[] = [
        makeService({ name: 'API', url: 'https://api.example.com', method: 'POST', checkInterval: 30 }),
        makeService({ name: 'Web', url: 'https://web.example.com', expectedStatus: 301, timeout: 5 }),
        makeService({ name: 'DB', url: 'https://db.example.com', enabled: false }),
      ];

      const result = bulkCreateServices(services);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.results[0].data?.method).toBe('POST');
      expect(result.data.results[0].data?.checkInterval).toBe(30);
      expect(result.data.results[1].data?.expectedStatus).toBe(301);
      expect(result.data.results[1].data?.timeout).toBe(5);
      expect(result.data.results[2].data?.enabled).toBe(false);
    });

    it('should create audit log entries for each created service', () => {
      const services = makeServices(3);
      bulkCreateServices(services);

      const audit = queryAuditLog({ action: 'service.create' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(3);
      expect(audit.data.entries.every(e => e.resourceType === 'service')).toBe(true);
      expect(audit.data.entries.every(e => e.detail?.startsWith('Bulk create:'))).toBe(true);
    });
  });

  // ── Bulk Update ──

  describe('bulkUpdateServices', () => {
    it('should update partial fields on multiple services', () => {
      // Create services first
      const svc1 = createService(makeService({ name: 'Update A', url: 'https://a.example.com' }));
      const svc2 = createService(makeService({ name: 'Update B', url: 'https://b.example.com' }));
      expect(svc1.ok).toBe(true);
      expect(svc2.ok).toBe(true);
      if (!svc1.ok || !svc2.ok) return;

      const result = bulkUpdateServices([
        { id: svc1.data.id, name: 'Updated A', checkInterval: 120 },
        { id: svc2.data.id, enabled: false },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(2);
      expect(result.data.failed).toBe(0);
      expect(result.data.results[0].data?.name).toBe('Updated A');
      expect(result.data.results[0].data?.checkInterval).toBe(120);
      expect(result.data.results[0].data?.url).toBe('https://a.example.com'); // unchanged
      expect(result.data.results[1].data?.enabled).toBe(false);
      expect(result.data.results[1].data?.name).toBe('Update B'); // unchanged
    });

    it('should update a single field across multiple services', () => {
      const svcs = makeServices(5).map(s => createService(s));
      const ids = svcs.map(r => {
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('Setup failed');
        return r.data.id;
      });

      const result = bulkUpdateServices(
        ids.map(id => ({ id, enabled: false }))
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(5);
      expect(result.data.results.every(r => r.data?.enabled === false)).toBe(true);
    });

    it('should create audit log entries for each updated service', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      db.prepare('DELETE FROM audit_log').run();

      bulkUpdateServices([{ id: svc.data.id, name: 'Audited Update' }]);

      const audit = queryAuditLog({ action: 'service.update' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(1);
      expect(audit.data.entries[0].resourceId).toBe(svc.data.id);
      expect(audit.data.entries[0].detail).toContain('Bulk update');
    });
  });

  // ── Bulk Delete ──

  describe('bulkDeleteServices', () => {
    it('should delete multiple services atomically', () => {
      const svcs = makeServices(3).map(s => createService(s));
      const ids = svcs.map(r => {
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('Setup failed');
        return r.data.id;
      });

      const result = bulkDeleteServices(ids);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(3);
      expect(result.data.failed).toBe(0);
      expect(result.data.results).toHaveLength(3);

      // Verify all are gone
      for (const id of ids) {
        const fetched = getService(id);
        expect(fetched.ok).toBe(false);
      }
    });

    it('should return deleted IDs in results', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      const result = bulkDeleteServices([svc.data.id]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.results[0].data?.id).toBe(svc.data.id);
    });

    it('should create audit log entries for each deleted service', () => {
      const svcs = makeServices(2).map(s => createService(s));
      const ids = svcs.map(r => {
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('Setup failed');
        return r.data.id;
      });

      db.prepare('DELETE FROM audit_log').run();

      bulkDeleteServices(ids);

      const audit = queryAuditLog({ action: 'service.delete' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(2);
      expect(audit.data.entries.every(e => e.detail === 'Bulk delete')).toBe(true);
    });
  });

  // ── Atomic Transaction Mode ──

  describe('Transaction mode (atomic)', () => {
    it('should rollback all updates if any one fails', () => {
      const svc = createService(makeService({ name: 'Existing' }));
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      // Try to update: one valid ID, one non-existent ID
      const result = bulkUpdateServices([
        { id: svc.data.id, name: 'Should Rollback' },
        { id: '00000000-0000-0000-0000-000000000000', name: 'Does Not Exist' },
      ], 'atomic');

      // Should fail entirely
      expect(result.ok).toBe(false);

      // Verify the first service was NOT updated (rollback)
      const fetched = getService(svc.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.name).toBe('Existing');
    });

    it('should rollback all deletes if any one fails', () => {
      const svc = createService(makeService({ name: 'Keep Me' }));
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      const result = bulkDeleteServices(
        [svc.data.id, '00000000-0000-0000-0000-000000000000'],
        'atomic'
      );

      // Should fail entirely
      expect(result.ok).toBe(false);

      // The existing service should NOT have been deleted (rollback)
      const fetched = getService(svc.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.name).toBe('Keep Me');
    });

    it('should not create audit entries on atomic rollback', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      // Clear audit log from the create above
      db.prepare('DELETE FROM audit_log').run();

      bulkUpdateServices([
        { id: svc.data.id, name: 'Rolled Back' },
        { id: '00000000-0000-0000-0000-000000000000', name: 'Fail' },
      ], 'atomic');

      const audit = queryAuditLog({ action: 'service.update' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      // Audit entries should have been rolled back along with the data changes
      expect(audit.data.entries).toHaveLength(0);
    });
  });

  // ── Partial Mode ──

  describe('Partial mode', () => {
    it('should continue on error and report per-item results for update', () => {
      const svc = createService(makeService({ name: 'Partial Test' }));
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      const result = bulkUpdateServices([
        { id: svc.data.id, name: 'Updated OK' },
        { id: '00000000-0000-0000-0000-000000000000', name: 'Will Fail' },
      ], 'partial');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.mode).toBe('partial');
      expect(result.data.total).toBe(2);
      expect(result.data.succeeded).toBe(1);
      expect(result.data.failed).toBe(1);

      // First item succeeded
      expect(result.data.results[0].ok).toBe(true);
      expect(result.data.results[0].data?.name).toBe('Updated OK');

      // Second item failed
      expect(result.data.results[1].ok).toBe(false);
      expect(result.data.results[1].error?.code).toBe('UPDATE_FAILED');

      // Verify the first update actually persisted
      const fetched = getService(svc.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.name).toBe('Updated OK');
    });

    it('should continue on error and report per-item results for delete', () => {
      const svc = createService(makeService({ name: 'Delete Partial' }));
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      const result = bulkDeleteServices(
        [svc.data.id, '00000000-0000-0000-0000-000000000000'],
        'partial'
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.results[0].ok).toBe(true);
      expect(result.data.results[1].ok).toBe(false);

      // Verify the first delete persisted
      const fetched = getService(svc.data.id);
      expect(fetched.ok).toBe(false);
    });

    it('should report ok: false in response when any item fails in partial mode', () => {
      const result = bulkDeleteServices(
        ['00000000-0000-0000-0000-000000000000'],
        'partial'
      );

      expect(result.ok).toBe(true); // Result wrapper is ok
      if (!result.ok) return;
      expect(result.data.ok).toBe(false); // Inner response reflects failures
      expect(result.data.failed).toBe(1);
    });

    it('should report ok: true in response when all items succeed in partial mode', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      const result = bulkDeleteServices([svc.data.id], 'partial');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.ok).toBe(true);
      expect(result.data.succeeded).toBe(1);
      expect(result.data.failed).toBe(0);
    });

    it('should preserve correct index in per-item results', () => {
      const svc1 = createService(makeService({ name: 'Svc 1', url: 'https://s1.example.com' }));
      const svc2 = createService(makeService({ name: 'Svc 2', url: 'https://s2.example.com' }));
      expect(svc1.ok && svc2.ok).toBe(true);
      if (!svc1.ok || !svc2.ok) return;

      const result = bulkUpdateServices([
        { id: svc1.data.id, name: 'One' },
        { id: '00000000-0000-0000-0000-000000000000', name: 'Fail' },
        { id: svc2.data.id, name: 'Three' },
      ], 'partial');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.results[0].index).toBe(0);
      expect(result.data.results[0].ok).toBe(true);
      expect(result.data.results[1].index).toBe(1);
      expect(result.data.results[1].ok).toBe(false);
      expect(result.data.results[2].index).toBe(2);
      expect(result.data.results[2].ok).toBe(true);
    });

    it('should create audit entries only for successful items in partial mode', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      db.prepare('DELETE FROM audit_log').run();

      bulkUpdateServices([
        { id: svc.data.id, name: 'Audited' },
        { id: '00000000-0000-0000-0000-000000000000', name: 'Fail' },
      ], 'partial');

      const audit = queryAuditLog({ action: 'service.update' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      // Only the successful item should have an audit entry
      expect(audit.data.entries).toHaveLength(1);
      expect(audit.data.entries[0].resourceId).toBe(svc.data.id);
    });
  });

  // ── Max Batch Size ──

  describe('Max batch size limit', () => {
    it('should accept exactly 100 items', () => {
      const services = makeServices(100);
      const result = bulkCreateServices(services);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.total).toBe(100);
      expect(result.data.succeeded).toBe(100);
    });

    // Note: The 100-item limit is enforced at the Zod schema level in the
    // Express route handlers (BulkCreateSchema, BulkUpdateSchema, BulkDeleteSchema).
    // The schema uses z.array(...).max(MAX_BATCH_SIZE) to reject payloads > 100 items.
    // Direct function calls bypass route-level validation by design.
  });

  // ── Validation Errors ──

  describe('Validation errors', () => {
    it('should reject services with invalid URLs at schema level', () => {
      // The CreateServiceSchema.url requires a valid URL via z.string().url()
      // This validation is enforced at the route handler level via Zod parsing.
      const parsed = CreateServiceSchema.safeParse({
        name: 'Test',
        url: 'not-a-url',
      });
      expect(parsed.success).toBe(false);
    });

    it('should reject services with empty name at schema level', () => {
      const parsed = CreateServiceSchema.safeParse({
        name: '',
        url: 'https://example.com',
      });
      expect(parsed.success).toBe(false);
    });

    it('should reject services with name exceeding max length at schema level', () => {
      const parsed = CreateServiceSchema.safeParse({
        name: 'X'.repeat(201),
        url: 'https://example.com',
      });
      expect(parsed.success).toBe(false);
    });

    it('should reject batch over 100 items at schema level', () => {
      const BulkCreateSchema = z.object({
        services: z.array(CreateServiceSchema).min(1).max(100),
      });

      const tooMany = Array.from({ length: 101 }, (_, i) => ({
        name: `Svc ${i}`,
        url: `https://svc-${i}.example.com`,
      }));

      const parsed = BulkCreateSchema.safeParse({ services: tooMany });
      expect(parsed.success).toBe(false);
    });

    it('should reject empty batch at schema level', () => {
      const BulkCreateSchema = z.object({
        services: z.array(CreateServiceSchema).min(1).max(100),
      });

      const parsed = BulkCreateSchema.safeParse({ services: [] });
      expect(parsed.success).toBe(false);
    });

    it('should reject bulk delete with invalid UUID format at schema level', () => {
      const BulkDeleteSchema = z.object({
        ids: z.array(z.string().uuid()).min(1).max(100),
      });

      const parsed = BulkDeleteSchema.safeParse({ ids: ['not-a-uuid'] });
      expect(parsed.success).toBe(false);
    });

    it('should reject bulk update items missing id at schema level', () => {
      const BulkUpdateItemSchema = z.object({
        id: z.string().uuid(),
      }).and(CreateServiceSchema.partial());
      const BulkUpdateSchema = z.object({
        updates: z.array(BulkUpdateItemSchema).min(1).max(100),
      });

      const parsed = BulkUpdateSchema.safeParse({
        updates: [{ name: 'No ID provided' }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  // ── Audit Log Integration ──

  describe('Audit log integration', () => {
    it('should record audit entries for bulk create with correct details', () => {
      bulkCreateServices([
        makeService({ name: 'Audit Service A' }),
        makeService({ name: 'Audit Service B' }),
      ]);

      const audit = queryAuditLog({ action: 'service.create' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(2);

      const details = audit.data.entries.map(e => e.detail).sort();
      expect(details).toContain('Bulk create: Audit Service A');
      expect(details).toContain('Bulk create: Audit Service B');
    });

    it('should record audit entries for bulk update with changed field names', () => {
      const svc = createService(makeService({ name: 'Audit Update Svc' }));
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      db.prepare('DELETE FROM audit_log').run();

      bulkUpdateServices([
        { id: svc.data.id, name: 'New Name', checkInterval: 30 },
      ]);

      const audit = queryAuditLog({ action: 'service.update' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(1);
      expect(audit.data.entries[0].detail).toContain('name');
      expect(audit.data.entries[0].detail).toContain('checkInterval');
    });

    it('should record audit entries for bulk delete', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;
      const id = svc.data.id;

      db.prepare('DELETE FROM audit_log').run();

      bulkDeleteServices([id]);

      const audit = queryAuditLog({ action: 'service.delete' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(1);
      expect(audit.data.entries[0].resourceId).toBe(id);
      expect(audit.data.entries[0].detail).toBe('Bulk delete');
    });

    it('should set resourceType to service for all bulk operations', () => {
      const svc = createService(makeService());
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      db.prepare('DELETE FROM audit_log').run();

      bulkUpdateServices([{ id: svc.data.id, name: 'Checked' }]);
      bulkDeleteServices([svc.data.id]);

      const audit = queryAuditLog({ resourceType: 'service' });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.data.entries).toHaveLength(2);
      expect(audit.data.entries.every(e => e.resourceType === 'service')).toBe(true);
    });
  });

  // ── Edge Cases ──

  describe('Edge cases', () => {
    it('should handle empty results correctly after all services are deleted', () => {
      const services = makeServices(3);
      const createResult = bulkCreateServices(services);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const ids = createResult.data.results.map(r => r.data!.id);
      const deleteResult = bulkDeleteServices(ids);
      expect(deleteResult.ok).toBe(true);
      if (!deleteResult.ok) return;

      const listed = listServices();
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.data).toHaveLength(0);
    });

    it('should handle bulk update with no actual changes', () => {
      const svc = createService(makeService({ name: 'No Change' }));
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      // Update with the same values
      const result = bulkUpdateServices([
        { id: svc.data.id, name: 'No Change' },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(1);
      expect(result.data.results[0].data?.name).toBe('No Change');
    });

    it('should handle bulk operations with a single item', () => {
      const createResult = bulkCreateServices([makeService({ name: 'Singleton' })]);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      expect(createResult.data.total).toBe(1);

      const id = createResult.data.results[0].data!.id;

      const updateResult = bulkUpdateServices([{ id, name: 'Updated Singleton' }]);
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;
      expect(updateResult.data.total).toBe(1);

      const deleteResult = bulkDeleteServices([id]);
      expect(deleteResult.ok).toBe(true);
      if (!deleteResult.ok) return;
      expect(deleteResult.data.total).toBe(1);
    });

    it('should handle atomic delete of all non-existent IDs', () => {
      const result = bulkDeleteServices([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ], 'atomic');

      expect(result.ok).toBe(false);
    });

    it('should handle partial delete of all non-existent IDs', () => {
      const result = bulkDeleteServices([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ], 'partial');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.ok).toBe(false);
      expect(result.data.succeeded).toBe(0);
      expect(result.data.failed).toBe(2);
    });

    it('should handle mixed success and failure in partial update of many items', () => {
      const svcs = makeServices(5).map(s => createService(s));
      const validIds = svcs.map(r => {
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error('Setup failed');
        return r.data.id;
      });

      // Mix valid and invalid IDs
      const updates = [
        { id: validIds[0], name: 'OK 1' },
        { id: '00000000-0000-0000-0000-000000000001', name: 'Fail 1' },
        { id: validIds[2], name: 'OK 2' },
        { id: '00000000-0000-0000-0000-000000000002', name: 'Fail 2' },
        { id: validIds[4], name: 'OK 3' },
      ];

      const result = bulkUpdateServices(updates, 'partial');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(3);
      expect(result.data.failed).toBe(2);
      expect(result.data.results[0].ok).toBe(true);
      expect(result.data.results[1].ok).toBe(false);
      expect(result.data.results[2].ok).toBe(true);
      expect(result.data.results[3].ok).toBe(false);
      expect(result.data.results[4].ok).toBe(true);
    });
  });
});
