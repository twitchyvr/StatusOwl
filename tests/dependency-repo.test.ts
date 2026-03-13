/**
 * Service Dependency Repository Tests
 *
 * Tests for service dependency CRUD, cycle detection, and downstream traversal.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { addDependency, removeDependency, getDependenciesOf, getDependentsOn, getDownstreamServices } from '../src/storage/dependency-repo.js';
import { createService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateService } from '../src/core/index.js';

describe('Service Dependency Repository', () => {
  let db: ReturnType<typeof getDb>;

  /** Helper to create a service and return its ID. */
  function makeService(name: string): string {
    const input: CreateService = { name, url: `https://${name.toLowerCase().replace(/\s+/g, '-')}.example.com` };
    const result = createService(input);
    if (!result.ok) throw new Error(`Failed to create service: ${result.error.message}`);
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
    // Clear relevant tables before each test for isolation
    db.prepare('DELETE FROM service_dependencies').run();
    db.prepare('DELETE FROM incident_updates').run();
    db.prepare('DELETE FROM incident_services').run();
    db.prepare('DELETE FROM incidents').run();
    db.prepare('DELETE FROM check_results').run();
    db.prepare('DELETE FROM services').run();
    db.prepare('DELETE FROM service_groups').run();
  });

  // ── addDependency ──

  describe('addDependency', () => {
    it('should create a dependency between two services', () => {
      const parentId = makeService('Parent API');
      const childId = makeService('Child API');

      const result = addDependency(parentId, childId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.parentServiceId).toBe(parentId);
      expect(result.data.childServiceId).toBe(childId);
      expect(result.data.createdAt).toBeDefined();
    });

    it('should reject self-dependency', () => {
      const serviceId = makeService('Self Service');

      const result = addDependency(serviceId, serviceId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('cannot depend on itself');
    });

    it('should reject duplicate dependency', () => {
      const parentId = makeService('Parent');
      const childId = makeService('Child');

      const first = addDependency(parentId, childId);
      expect(first.ok).toBe(true);

      const duplicate = addDependency(parentId, childId);

      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.error.code).toBe('DUPLICATE');
    });

    it('should reject direct circular dependency (A->B, B->A)', () => {
      const serviceA = makeService('Service A');
      const serviceB = makeService('Service B');

      const first = addDependency(serviceA, serviceB);
      expect(first.ok).toBe(true);

      const circular = addDependency(serviceB, serviceA);

      expect(circular.ok).toBe(false);
      if (circular.ok) return;
      expect(circular.error.code).toBe('VALIDATION');
      expect(circular.error.message).toContain('circular');
    });

    it('should reject transitive circular dependency (A->B, B->C, C->A)', () => {
      const serviceA = makeService('Service A');
      const serviceB = makeService('Service B');
      const serviceC = makeService('Service C');

      const ab = addDependency(serviceA, serviceB);
      expect(ab.ok).toBe(true);

      const bc = addDependency(serviceB, serviceC);
      expect(bc.ok).toBe(true);

      const ca = addDependency(serviceC, serviceA);

      expect(ca.ok).toBe(false);
      if (ca.ok) return;
      expect(ca.error.code).toBe('VALIDATION');
      expect(ca.error.message).toContain('circular');
    });
  });

  // ── removeDependency ──

  describe('removeDependency', () => {
    it('should remove an existing dependency', () => {
      const parentId = makeService('Parent');
      const childId = makeService('Child');

      const addResult = addDependency(parentId, childId);
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const removeResult = removeDependency(addResult.data.id);

      expect(removeResult.ok).toBe(true);
      if (!removeResult.ok) return;
      expect(removeResult.data.deleted).toBe(true);

      // Verify it's gone
      const deps = getDependenciesOf(parentId);
      expect(deps.ok).toBe(true);
      if (!deps.ok) return;
      expect(deps.data.length).toBe(0);
    });

    it('should return NOT_FOUND for a non-existent dependency', () => {
      const result = removeDependency('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── getDependenciesOf ──

  describe('getDependenciesOf', () => {
    it('should return children of a service', () => {
      const parentId = makeService('Parent');
      const childA = makeService('Child A');
      const childB = makeService('Child B');

      addDependency(parentId, childA);
      addDependency(parentId, childB);

      const result = getDependenciesOf(parentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(2);

      const childIds = result.data.map((d) => d.childServiceId);
      expect(childIds).toContain(childA);
      expect(childIds).toContain(childB);
    });

    it('should return an empty array when a service has no dependencies', () => {
      const serviceId = makeService('Standalone');

      const result = getDependenciesOf(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });
  });

  // ── getDependentsOn ──

  describe('getDependentsOn', () => {
    it('should return parents of a service', () => {
      const parentA = makeService('Parent A');
      const parentB = makeService('Parent B');
      const child = makeService('Child');

      addDependency(parentA, child);
      addDependency(parentB, child);

      const result = getDependentsOn(child);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(2);

      const parentIds = result.data.map((d) => d.parentServiceId);
      expect(parentIds).toContain(parentA);
      expect(parentIds).toContain(parentB);
    });

    it('should return an empty array when nothing depends on a service', () => {
      const serviceId = makeService('Leaf');

      const result = getDependentsOn(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });
  });

  // ── getDownstreamServices ──

  describe('getDownstreamServices', () => {
    it('should return all transitive children', () => {
      // Build a tree: A -> B -> C, A -> D
      const serviceA = makeService('Service A');
      const serviceB = makeService('Service B');
      const serviceC = makeService('Service C');
      const serviceD = makeService('Service D');

      addDependency(serviceA, serviceB);
      addDependency(serviceB, serviceC);
      addDependency(serviceA, serviceD);

      const result = getDownstreamServices(serviceA);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);
      expect(result.data).toContain(serviceB);
      expect(result.data).toContain(serviceC);
      expect(result.data).toContain(serviceD);
    });

    it('should return an empty array for a leaf service', () => {
      const serviceId = makeService('Leaf');

      const result = getDownstreamServices(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });

    it('should handle diamond dependencies without duplicates', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const serviceA = makeService('A');
      const serviceB = makeService('B');
      const serviceC = makeService('C');
      const serviceD = makeService('D');

      addDependency(serviceA, serviceB);
      addDependency(serviceA, serviceC);
      addDependency(serviceB, serviceD);
      addDependency(serviceC, serviceD);

      const result = getDownstreamServices(serviceA);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);
      expect(result.data).toContain(serviceB);
      expect(result.data).toContain(serviceC);
      expect(result.data).toContain(serviceD);
    });
  });
});
