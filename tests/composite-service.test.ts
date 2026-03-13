/**
 * Composite Service Tests
 *
 * Tests for composite service creation, child management, all three
 * derivation rules (worst-case, majority, weighted), cycle detection,
 * nested composites, and status computation accuracy.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  createCompositeService,
  addChild,
  removeChild,
  getChildren,
  computeStatus,
} from '../src/monitors/composite-service.js';
import { createService, updateServiceStatus, getService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateService, ServiceStatus } from '../src/core/index.js';

describe('Composite Service', () => {
  let db: ReturnType<typeof getDb>;

  /** Helper to create a regular service and return its ID. */
  function makeService(name: string, status: ServiceStatus = 'operational'): string {
    const input: CreateService = {
      name,
      url: `https://${name.toLowerCase().replace(/\s+/g, '-')}.example.com`,
    };
    const result = createService(input);
    if (!result.ok) throw new Error(`Failed to create service: ${result.error.message}`);

    // Set the desired status
    updateServiceStatus(result.data.id, status);
    return result.data.id;
  }

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear all tables that might have FK constraints or test data
    db.prepare('DELETE FROM composite_children').run();
    db.prepare('DELETE FROM service_dependencies').run();
    db.prepare('DELETE FROM incident_updates').run();
    db.prepare('DELETE FROM incident_services').run();
    db.prepare('DELETE FROM incidents').run();
    db.prepare('DELETE FROM check_results').run();
    db.prepare('DELETE FROM services').run();
    db.prepare('DELETE FROM service_groups').run();
  });

  // ── createCompositeService ──

  describe('createCompositeService', () => {
    it('should create a composite service with children', () => {
      const childA = makeService('Child A');
      const childB = makeService('Child B');

      const result = createCompositeService('My Composite', [childA, childB]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('My Composite');
      expect(result.data.checkType).toBe('composite');
      expect(result.data.id).toBeDefined();
    });

    it('should create a composite with no children', () => {
      const result = createCompositeService('Empty Composite', []);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.checkType).toBe('composite');

      // Verify no children
      const children = getChildren(result.data.id);
      expect(children.ok).toBe(true);
      if (!children.ok) return;
      expect(children.data.length).toBe(0);
    });

    it('should create a composite with a specific derivation rule', () => {
      const child = makeService('Child');

      const result = createCompositeService('Weighted Composite', [child], 'weighted');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const children = getChildren(result.data.id);
      expect(children.ok).toBe(true);
      if (!children.ok) return;
      expect(children.data.length).toBe(1);
      expect(children.data[0].derivationRule).toBe('weighted');
    });

    it('should reject duplicate child IDs in creation', () => {
      const child = makeService('Child');

      const result = createCompositeService('Dup Composite', [child, child]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('Duplicate');
    });

    it('should reject non-existent child IDs', () => {
      const result = createCompositeService('Bad Composite', ['00000000-0000-0000-0000-000000000000']);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should default to worst-case derivation rule', () => {
      const child = makeService('Child');

      const result = createCompositeService('Default Rule', [child]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const children = getChildren(result.data.id);
      expect(children.ok).toBe(true);
      if (!children.ok) return;
      expect(children.data[0].derivationRule).toBe('worst-case');
    });
  });

  // ── addChild ──

  describe('addChild', () => {
    it('should add a child to an existing composite', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const child = makeService('New Child');
      const result = addChild(compositeResult.data.id, child);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.compositeId).toBe(compositeResult.data.id);
      expect(result.data.childId).toBe(child);
      expect(result.data.weight).toBe(1.0);
    });

    it('should add a child with a custom weight', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const child = makeService('Weighted Child');
      const result = addChild(compositeResult.data.id, child, 3.5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.weight).toBe(3.5);
    });

    it('should reject adding to a non-composite service', () => {
      const regular = makeService('Regular Service');
      const child = makeService('Child');

      const result = addChild(regular, child);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('not a composite');
    });

    it('should reject self-reference', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const result = addChild(compositeResult.data.id, compositeResult.data.id);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('itself');
    });

    it('should reject duplicate children', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const child = makeService('Child');
      const first = addChild(compositeResult.data.id, child);
      expect(first.ok).toBe(true);

      const duplicate = addChild(compositeResult.data.id, child);
      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.error.code).toBe('DUPLICATE');
    });

    it('should reject non-existent composite ID', () => {
      const child = makeService('Child');
      const result = addChild('00000000-0000-0000-0000-000000000000', child);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should reject non-existent child ID', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const result = addChild(compositeResult.data.id, '00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should reject zero or negative weight', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const child = makeService('Child');
      const result = addChild(compositeResult.data.id, child, 0);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('Weight');
    });
  });

  // ── removeChild ──

  describe('removeChild', () => {
    it('should remove an existing child', () => {
      const child = makeService('Child');
      const compositeResult = createCompositeService('Composite', [child]);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const result = removeChild(compositeResult.data.id, child);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.removed).toBe(true);

      // Verify child is gone
      const children = getChildren(compositeResult.data.id);
      expect(children.ok).toBe(true);
      if (!children.ok) return;
      expect(children.data.length).toBe(0);
    });

    it('should return NOT_FOUND for a child that is not in the composite', () => {
      const compositeResult = createCompositeService('Composite', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const result = removeChild(compositeResult.data.id, '00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should only remove the specified child, not others', () => {
      const childA = makeService('Child A');
      const childB = makeService('Child B');
      const compositeResult = createCompositeService('Composite', [childA, childB]);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      removeChild(compositeResult.data.id, childA);

      const children = getChildren(compositeResult.data.id);
      expect(children.ok).toBe(true);
      if (!children.ok) return;
      expect(children.data.length).toBe(1);
      expect(children.data[0].childId).toBe(childB);
    });
  });

  // ── getChildren ──

  describe('getChildren', () => {
    it('should return all children with weights', () => {
      const childA = makeService('Child A');
      const childB = makeService('Child B');
      const compositeResult = createCompositeService('Composite', [childA, childB]);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const result = getChildren(compositeResult.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(2);

      const childIds = result.data.map((c) => c.childId);
      expect(childIds).toContain(childA);
      expect(childIds).toContain(childB);

      // Default weight is 1.0
      for (const child of result.data) {
        expect(child.weight).toBe(1.0);
      }
    });

    it('should return empty array for composite with no children', () => {
      const compositeResult = createCompositeService('Empty', []);
      expect(compositeResult.ok).toBe(true);
      if (!compositeResult.ok) return;

      const result = getChildren(compositeResult.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });

    it('should return empty array for a non-existent composite', () => {
      const result = getChildren('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });
  });

  // ── Cycle detection ──

  describe('cycle detection', () => {
    it('should reject direct cycle: composite A contains composite B, B tries to contain A', () => {
      const child = makeService('Leaf');

      const compositeA = createCompositeService('Composite A', [child]);
      expect(compositeA.ok).toBe(true);
      if (!compositeA.ok) return;

      const compositeB = createCompositeService('Composite B', [compositeA.data.id]);
      expect(compositeB.ok).toBe(true);
      if (!compositeB.ok) return;

      // Try to add A as child of B's existing composite — but B already contains A
      // Actually: B contains A.id. Now try to add B.id as child of A => A -> B -> A cycle
      const result = addChild(compositeA.data.id, compositeB.data.id);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('circular');
    });

    it('should reject transitive cycle: A -> B -> C, then C -> A', () => {
      const leaf = makeService('Leaf');

      const compositeC = createCompositeService('Composite C', [leaf]);
      expect(compositeC.ok).toBe(true);
      if (!compositeC.ok) return;

      const compositeB = createCompositeService('Composite B', [compositeC.data.id]);
      expect(compositeB.ok).toBe(true);
      if (!compositeB.ok) return;

      const compositeA = createCompositeService('Composite A', [compositeB.data.id]);
      expect(compositeA.ok).toBe(true);
      if (!compositeA.ok) return;

      // Try to add A as child of C => C -> A -> B -> C cycle
      const result = addChild(compositeC.data.id, compositeA.data.id);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('circular');
    });

    it('should allow non-circular hierarchies', () => {
      const childA = makeService('Child A');
      const childB = makeService('Child B');
      const childC = makeService('Child C');

      // A contains childA, B contains childB, C contains childC
      const compositeA = createCompositeService('Composite A', [childA]);
      expect(compositeA.ok).toBe(true);
      if (!compositeA.ok) return;

      const compositeB = createCompositeService('Composite B', [childB]);
      expect(compositeB.ok).toBe(true);
      if (!compositeB.ok) return;

      // Parent that contains both A and B (no cycle)
      const compositeParent = createCompositeService('Parent', [compositeA.data.id, compositeB.data.id]);
      expect(compositeParent.ok).toBe(true);
    });
  });

  // ── Nested composites ──

  describe('nested composites', () => {
    it('should support composite containing other composites', () => {
      const leaf1 = makeService('Leaf 1');
      const leaf2 = makeService('Leaf 2');
      const leaf3 = makeService('Leaf 3');

      const innerA = createCompositeService('Inner A', [leaf1, leaf2]);
      expect(innerA.ok).toBe(true);
      if (!innerA.ok) return;

      const innerB = createCompositeService('Inner B', [leaf3]);
      expect(innerB.ok).toBe(true);
      if (!innerB.ok) return;

      const outer = createCompositeService('Outer', [innerA.data.id, innerB.data.id]);
      expect(outer.ok).toBe(true);
      if (!outer.ok) return;

      const children = getChildren(outer.data.id);
      expect(children.ok).toBe(true);
      if (!children.ok) return;
      expect(children.data.length).toBe(2);
    });

    it('should compute nested composite status recursively', () => {
      // Inner composite: leaf1 (operational) + leaf2 (major_outage) => worst-case = major_outage
      const leaf1 = makeService('Leaf 1', 'operational');
      const leaf2 = makeService('Leaf 2', 'major_outage');

      const inner = createCompositeService('Inner', [leaf1, leaf2], 'worst-case');
      expect(inner.ok).toBe(true);
      if (!inner.ok) return;

      // Compute inner status first
      const innerStatus = computeStatus(inner.data.id);
      expect(innerStatus.ok).toBe(true);
      if (!innerStatus.ok) return;
      expect(innerStatus.data).toBe('major_outage');

      // Outer composite: inner (now major_outage) + leaf3 (operational) => worst-case = major_outage
      const leaf3 = makeService('Leaf 3', 'operational');
      const outer = createCompositeService('Outer', [inner.data.id, leaf3], 'worst-case');
      expect(outer.ok).toBe(true);
      if (!outer.ok) return;

      const outerStatus = computeStatus(outer.data.id);
      expect(outerStatus.ok).toBe(true);
      if (!outerStatus.ok) return;
      expect(outerStatus.data).toBe('major_outage');
    });
  });

  // ── computeStatus: worst-case ──

  describe('computeStatus — worst-case', () => {
    it('should return operational when all children are operational', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'operational');
      const childC = makeService('C', 'operational');

      const composite = createCompositeService('Composite', [childA, childB, childC], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('operational');
    });

    it('should return degraded when any child is degraded and none are worse', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');
      const childC = makeService('C', 'operational');

      const composite = createCompositeService('Composite', [childA, childB, childC], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('degraded');
    });

    it('should return major_outage when any child is in major_outage', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');
      const childC = makeService('C', 'major_outage');

      const composite = createCompositeService('Composite', [childA, childB, childC], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('major_outage');
    });

    it('should return unknown for a composite with no children', () => {
      const composite = createCompositeService('Empty', [], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('unknown');
    });

    it('should persist the computed status to the database', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');

      const composite = createCompositeService('Composite', [childA, childB], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      computeStatus(composite.data.id);

      // Re-read the service from DB
      const service = getService(composite.data.id);
      expect(service.ok).toBe(true);
      if (!service.ok) return;
      expect(service.data.status).toBe('degraded');
    });

    it('should pick partial_outage over degraded', () => {
      const childA = makeService('A', 'degraded');
      const childB = makeService('B', 'partial_outage');

      const composite = createCompositeService('Composite', [childA, childB], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('partial_outage');
    });

    it('should handle maintenance status as worst', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'maintenance');

      const composite = createCompositeService('Composite', [childA, childB], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('maintenance');
    });
  });

  // ── computeStatus: majority ──

  describe('computeStatus — majority', () => {
    it('should return the status held by more than 50% of children', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'operational');
      const childC = makeService('C', 'degraded');

      const composite = createCompositeService('Composite', [childA, childB, childC], 'majority');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('operational');
    });

    it('should return degraded when majority of children are degraded', () => {
      const childA = makeService('A', 'degraded');
      const childB = makeService('B', 'degraded');
      const childC = makeService('C', 'operational');

      const composite = createCompositeService('Composite', [childA, childB, childC], 'majority');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('degraded');
    });

    it('should fall back to worst-case when no status has >50%', () => {
      // 3 children, each with a different status — no majority
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');
      const childC = makeService('C', 'major_outage');

      const composite = createCompositeService('Composite', [childA, childB, childC], 'majority');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // No majority => worst-case => major_outage
      expect(result.data).toBe('major_outage');
    });

    it('should handle two children with split statuses (50/50 is not >50%)', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');

      const composite = createCompositeService('Composite', [childA, childB], 'majority');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 50% is not > 50%, so falls back to worst-case => degraded
      expect(result.data).toBe('degraded');
    });

    it('should handle single child as automatic majority', () => {
      const child = makeService('Only Child', 'major_outage');

      const composite = createCompositeService('Composite', [child], 'majority');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('major_outage');
    });

    it('should detect majority with 4 children (3 same)', () => {
      const childA = makeService('A', 'degraded');
      const childB = makeService('B', 'degraded');
      const childC = makeService('C', 'degraded');
      const childD = makeService('D', 'operational');

      const composite = createCompositeService('Composite', [childA, childB, childC, childD], 'majority');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('degraded');
    });
  });

  // ── computeStatus: weighted ──

  describe('computeStatus — weighted', () => {
    it('should derive status from highest total weight', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');

      const composite = createCompositeService('Composite', [], 'weighted');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      // Add children with different weights
      addChild(composite.data.id, childA, 5.0);
      addChild(composite.data.id, childB, 1.0);

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // operational has weight 5, degraded has weight 1 => operational wins
      expect(result.data).toBe('operational');
    });

    it('should pick degraded when it has higher total weight', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');
      const childC = makeService('C', 'degraded');

      const composite = createCompositeService('Composite', [], 'weighted');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      addChild(composite.data.id, childA, 1.0);
      addChild(composite.data.id, childB, 3.0);
      addChild(composite.data.id, childC, 3.0);

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // degraded total weight = 6, operational total weight = 1 => degraded
      expect(result.data).toBe('degraded');
    });

    it('should break ties by worst severity', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'degraded');

      const composite = createCompositeService('Composite', [], 'weighted');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      // Equal weights
      addChild(composite.data.id, childA, 2.0);
      addChild(composite.data.id, childB, 2.0);

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Equal weight => tie broken by severity => degraded is worse => degraded wins
      expect(result.data).toBe('degraded');
    });

    it('should handle multiple statuses with accumulated weights', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'operational');
      const childC = makeService('C', 'major_outage');

      const composite = createCompositeService('Composite', [], 'weighted');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      addChild(composite.data.id, childA, 2.0);
      addChild(composite.data.id, childB, 2.0);
      addChild(composite.data.id, childC, 3.0);

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // operational total = 4, major_outage total = 3 => operational wins
      expect(result.data).toBe('operational');
    });

    it('should work with fractional weights', () => {
      const childA = makeService('A', 'degraded');
      const childB = makeService('B', 'operational');

      const composite = createCompositeService('Composite', [], 'weighted');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      addChild(composite.data.id, childA, 0.5);
      addChild(composite.data.id, childB, 0.3);

      const result = computeStatus(composite.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // degraded = 0.5, operational = 0.3 => degraded wins
      expect(result.data).toBe('degraded');
    });
  });

  // ── Status recomputation after child status changes ──

  describe('status recomputation', () => {
    it('should reflect changes in child status on recomputation', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'operational');

      const composite = createCompositeService('Composite', [childA, childB], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      // Initially all operational
      let result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('operational');

      // Child B goes down
      updateServiceStatus(childB, 'major_outage');

      // Recompute
      result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('major_outage');

      // Child B recovers
      updateServiceStatus(childB, 'operational');

      result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('operational');
    });

    it('should update status after adding a degraded child', () => {
      const childA = makeService('A', 'operational');

      const composite = createCompositeService('Composite', [childA], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      let result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('operational');

      // Add a degraded child
      const childB = makeService('B', 'degraded');
      addChild(composite.data.id, childB);

      result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('degraded');
    });

    it('should update status after removing a failing child', () => {
      const childA = makeService('A', 'operational');
      const childB = makeService('B', 'major_outage');

      const composite = createCompositeService('Composite', [childA, childB], 'worst-case');
      expect(composite.ok).toBe(true);
      if (!composite.ok) return;

      let result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('major_outage');

      // Remove the failing child
      removeChild(composite.data.id, childB);

      result = computeStatus(composite.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBe('operational');
    });
  });
});
