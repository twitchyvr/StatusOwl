/**
 * StatusOwl — Service Dependency Repository
 */

import { randomUUID } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from './database.js';
import type { Result, ServiceDependency } from '../core/index.js';

const log = createChildLogger('DependencyRepo');

function rowToDependency(row: Record<string, unknown>): ServiceDependency {
  return {
    id: row.id as string,
    parentServiceId: row.parent_service_id as string,
    childServiceId: row.child_service_id as string,
    createdAt: row.created_at as string,
  };
}

export function addDependency(parentServiceId: string, childServiceId: string): Result<ServiceDependency> {
  try {
    if (parentServiceId === childServiceId) {
      return err('VALIDATION', 'A service cannot depend on itself');
    }

    // Check for circular dependency
    if (wouldCreateCycle(parentServiceId, childServiceId)) {
      return err('VALIDATION', 'Adding this dependency would create a circular dependency');
    }

    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO service_dependencies (id, parent_service_id, child_service_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, parentServiceId, childServiceId, now);

    log.info({ parentServiceId, childServiceId }, 'Dependency added');
    return ok({ id, parentServiceId, childServiceId, createdAt: now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint')) {
      return err('DUPLICATE', 'This dependency already exists');
    }
    return err('DB_ERROR', msg);
  }
}

export function removeDependency(id: string): Result<{ deleted: true }> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM service_dependencies WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Dependency ${id} not found`);
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function getDependenciesOf(serviceId: string): Result<ServiceDependency[]> {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM service_dependencies WHERE parent_service_id = ? ORDER BY created_at'
    ).all(serviceId) as Record<string, unknown>[];
    return ok(rows.map(rowToDependency));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function getDependentsOn(serviceId: string): Result<ServiceDependency[]> {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM service_dependencies WHERE child_service_id = ? ORDER BY created_at'
    ).all(serviceId) as Record<string, unknown>[];
    return ok(rows.map(rowToDependency));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

/**
 * Get all services that are downstream (children, grandchildren, etc.) of a parent.
 * Used for cascading status when a parent goes down.
 */
export function getDownstreamServices(serviceId: string): Result<string[]> {
  try {
    const db = getDb();
    const downstream: Set<string> = new Set();
    const queue = [serviceId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = db.prepare(
        'SELECT child_service_id FROM service_dependencies WHERE parent_service_id = ?'
      ).all(current) as { child_service_id: string }[];

      for (const child of children) {
        if (!downstream.has(child.child_service_id)) {
          downstream.add(child.child_service_id);
          queue.push(child.child_service_id);
        }
      }
    }

    return ok(Array.from(downstream));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

/**
 * Check if adding a dependency from parent->child would create a cycle.
 */
function wouldCreateCycle(parentServiceId: string, childServiceId: string): boolean {
  try {
    const db = getDb();
    const visited = new Set<string>();
    const queue = [childServiceId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === parentServiceId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const children = db.prepare(
        'SELECT child_service_id FROM service_dependencies WHERE parent_service_id = ?'
      ).all(current) as { child_service_id: string }[];

      for (const child of children) {
        queue.push(child.child_service_id);
      }
    }

    return false;
  } catch {
    return false;
  }
}
