/**
 * StatusOwl — Composite Service Engine
 *
 * Creates and manages composite services whose status is derived
 * from their children using configurable derivation rules:
 *   - worst-case: any child down => composite down
 *   - majority: status = most common among children (>50%)
 *   - weighted: status weighted by per-child weight values
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/database.js';
import { getService, updateServiceStatus } from '../storage/service-repo.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, Service, ServiceStatus } from '../core/index.js';

const log = createChildLogger('CompositeService');

// ── Types ──

export type DerivationRule = 'worst-case' | 'majority' | 'weighted';

export interface CompositeChild {
  compositeId: string;
  childId: string;
  weight: number;
  derivationRule: DerivationRule;
  createdAt: string;
}

// ── Severity ranking (higher = worse) ──

const STATUS_SEVERITY: Record<ServiceStatus, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
  maintenance: 4,
  unknown: 5,
};

const SEVERITY_TO_STATUS: ServiceStatus[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
];

// ── Row mapping ──

function rowToChild(row: Record<string, unknown>): CompositeChild {
  return {
    compositeId: row.composite_id as string,
    childId: row.child_id as string,
    weight: row.weight as number,
    derivationRule: row.derivation_rule as DerivationRule,
    createdAt: row.created_at as string,
  };
}

// ── Derivation rule lookup ──

/**
 * Read the derivation rule stored in a composite service's body column.
 * Falls back to 'worst-case' if not found or unparseable.
 */
function getDerivationRule(compositeId: string): DerivationRule {
  try {
    const db = getDb();
    const row = db.prepare('SELECT body FROM services WHERE id = ? AND check_type = ?').get(compositeId, 'composite') as { body: string | null } | undefined;
    if (row?.body) {
      const parsed = JSON.parse(row.body) as { derivationRule?: string };
      if (parsed.derivationRule && ['worst-case', 'majority', 'weighted'].includes(parsed.derivationRule)) {
        return parsed.derivationRule as DerivationRule;
      }
    }
  } catch {
    // fall through
  }
  return 'worst-case';
}

// ── Cycle detection (BFS, adapted from dependency-repo pattern) ──

/**
 * Check if adding childId as a child of compositeId would create a cycle.
 * Walks the composite_children graph downward from childId; if it reaches
 * compositeId, a cycle would form.
 */
function wouldCreateCycle(compositeId: string, childId: string): boolean {
  try {
    const db = getDb();
    const visited = new Set<string>();
    const queue = [childId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === compositeId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      // Walk children of `current` in the composite tree
      const rows = db.prepare(
        'SELECT child_id FROM composite_children WHERE composite_id = ?'
      ).all(current) as { child_id: string }[];

      for (const row of rows) {
        queue.push(row.child_id);
      }
    }

    return false;
  } catch {
    // Fail-safe: assume cycle to prevent corruption
    return true;
  }
}

// ── Public API ──

/**
 * Create a composite service. Inserts a service row with check_type='composite'
 * and no real URL (uses a placeholder), then optionally adds initial children.
 */
export function createCompositeService(
  name: string,
  childIds: string[],
  derivationRule: DerivationRule = 'worst-case',
): Result<Service> {
  try {
    const db = getDb();

    // Validate derivation rule
    if (!['worst-case', 'majority', 'weighted'].includes(derivationRule)) {
      return err('VALIDATION', `Invalid derivation rule: ${derivationRule}`);
    }

    // Validate that all child IDs exist and none are duplicated
    const uniqueChildIds = [...new Set(childIds)];
    for (const childId of uniqueChildIds) {
      const childResult = getService(childId);
      if (!childResult.ok) {
        return err('NOT_FOUND', `Child service ${childId} does not exist`);
      }
    }

    // Check for duplicate children in input
    if (uniqueChildIds.length !== childIds.length) {
      return err('VALIDATION', 'Duplicate child IDs provided');
    }

    // Create the composite service row
    // Store the derivation rule in the body column as JSON metadata
    const id = randomUUID();
    const now = new Date().toISOString();
    const metadata = JSON.stringify({ derivationRule });

    db.prepare(`
      INSERT INTO services (id, name, url, method, check_type, expected_status, check_interval, timeout, body, status, enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'GET', 'composite', 200, 60, 10, ?, 'unknown', 1, 0, ?, ?)
    `).run(id, name, 'composite://aggregate', metadata, now, now);

    // Add children
    const insertChild = db.prepare(`
      INSERT INTO composite_children (composite_id, child_id, weight, derivation_rule, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const childId of uniqueChildIds) {
      insertChild.run(id, childId, 1.0, derivationRule, now);
    }

    log.info({ id, name, childCount: uniqueChildIds.length, derivationRule }, 'Composite service created');

    return getService(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to create composite service');
    return err('CREATE_FAILED', msg);
  }
}

/**
 * Add a child service to an existing composite service.
 */
export function addChild(
  compositeId: string,
  childId: string,
  weight: number = 1.0,
): Result<CompositeChild> {
  try {
    const db = getDb();

    // Verify composite exists and is actually a composite
    const compositeResult = getService(compositeId);
    if (!compositeResult.ok) {
      return err('NOT_FOUND', `Composite service ${compositeId} not found`);
    }
    if (compositeResult.data.checkType !== 'composite') {
      return err('VALIDATION', `Service ${compositeId} is not a composite service`);
    }

    // Verify child exists
    const childResult = getService(childId);
    if (!childResult.ok) {
      return err('NOT_FOUND', `Child service ${childId} not found`);
    }

    // Self-reference check
    if (compositeId === childId) {
      return err('VALIDATION', 'A composite service cannot contain itself as a child');
    }

    // Cycle detection
    if (wouldCreateCycle(compositeId, childId)) {
      return err('VALIDATION', 'Adding this child would create a circular hierarchy');
    }

    // Weight validation
    if (weight <= 0) {
      return err('VALIDATION', 'Weight must be greater than zero');
    }

    // Get the derivation rule from the composite service's metadata
    const derivationRule = getDerivationRule(compositeId);

    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO composite_children (composite_id, child_id, weight, derivation_rule, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(compositeId, childId, weight, derivationRule, now);

    log.info({ compositeId, childId, weight }, 'Child added to composite service');

    return ok({
      compositeId,
      childId,
      weight,
      derivationRule,
      createdAt: now,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint') || msg.includes('PRIMARY KEY')) {
      return err('DUPLICATE', 'This child is already part of the composite service');
    }
    log.error({ error: msg }, 'Failed to add child to composite service');
    return err('DB_ERROR', msg);
  }
}

/**
 * Remove a child service from a composite service.
 */
export function removeChild(
  compositeId: string,
  childId: string,
): Result<{ removed: true }> {
  try {
    const db = getDb();

    const result = db.prepare(
      'DELETE FROM composite_children WHERE composite_id = ? AND child_id = ?'
    ).run(compositeId, childId);

    if (result.changes === 0) {
      return err('NOT_FOUND', `Child ${childId} is not part of composite ${compositeId}`);
    }

    log.info({ compositeId, childId }, 'Child removed from composite service');
    return ok({ removed: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to remove child from composite service');
    return err('DB_ERROR', msg);
  }
}

/**
 * List all children of a composite service with their weights.
 */
export function getChildren(compositeId: string): Result<CompositeChild[]> {
  try {
    const db = getDb();

    const rows = db.prepare(
      'SELECT * FROM composite_children WHERE composite_id = ? ORDER BY created_at ASC'
    ).all(compositeId) as Record<string, unknown>[];

    return ok(rows.map(rowToChild));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to get composite children');
    return err('DB_ERROR', msg);
  }
}

/**
 * Compute the derived status of a composite service from its children.
 * Also updates the composite service's status in the database.
 */
export function computeStatus(compositeId: string): Result<ServiceStatus> {
  try {
    // Get children
    const childrenResult = getChildren(compositeId);
    if (!childrenResult.ok) return childrenResult;

    const children = childrenResult.data;

    // No children => unknown
    if (children.length === 0) {
      updateServiceStatus(compositeId, 'unknown');
      return ok('unknown' as ServiceStatus);
    }

    // Read derivation rule from the composite service's stored metadata
    const derivationRule = getDerivationRule(compositeId);

    // Gather child statuses
    const childStatuses: Array<{ status: ServiceStatus; weight: number }> = [];
    for (const child of children) {
      const childService = getService(child.childId);
      if (!childService.ok) {
        // If a child was deleted, skip it
        log.warn({ compositeId, childId: child.childId }, 'Child service not found, skipping');
        continue;
      }
      childStatuses.push({
        status: childService.data.status,
        weight: child.weight,
      });
    }

    // No valid children => unknown
    if (childStatuses.length === 0) {
      updateServiceStatus(compositeId, 'unknown');
      return ok('unknown' as ServiceStatus);
    }

    let derivedStatus: ServiceStatus;

    switch (derivationRule) {
      case 'worst-case':
        derivedStatus = deriveWorstCase(childStatuses);
        break;
      case 'majority':
        derivedStatus = deriveMajority(childStatuses);
        break;
      case 'weighted':
        derivedStatus = deriveWeighted(childStatuses);
        break;
      default:
        derivedStatus = deriveWorstCase(childStatuses);
    }

    // Persist the derived status
    updateServiceStatus(compositeId, derivedStatus);

    log.info({ compositeId, derivedStatus, derivationRule, childCount: childStatuses.length }, 'Composite status computed');

    return ok(derivedStatus);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to compute composite status');
    return err('COMPUTE_FAILED', msg);
  }
}

// ── Derivation strategies ──

/**
 * Worst-case: the composite takes the worst status among all children.
 * Severity ranking: operational < degraded < partial_outage < major_outage < maintenance < unknown
 */
function deriveWorstCase(
  children: Array<{ status: ServiceStatus; weight: number }>,
): ServiceStatus {
  let worstSeverity = 0;

  for (const child of children) {
    const severity = STATUS_SEVERITY[child.status] ?? 0;
    if (severity > worstSeverity) {
      worstSeverity = severity;
    }
  }

  return SEVERITY_TO_STATUS[worstSeverity] ?? 'unknown';
}

/**
 * Majority: the composite takes whichever status has >50% of children.
 * If no status has a strict majority, falls back to worst-case.
 */
function deriveMajority(
  children: Array<{ status: ServiceStatus; weight: number }>,
): ServiceStatus {
  const counts = new Map<ServiceStatus, number>();

  for (const child of children) {
    counts.set(child.status, (counts.get(child.status) ?? 0) + 1);
  }

  const total = children.length;

  // Find status with >50%
  for (const [status, count] of counts) {
    if (count > total / 2) {
      return status;
    }
  }

  // No majority — fall back to worst-case
  return deriveWorstCase(children);
}

/**
 * Weighted: each child contributes its weight toward its status.
 * The status with the highest total weight wins.
 * Ties are broken by worst severity.
 */
function deriveWeighted(
  children: Array<{ status: ServiceStatus; weight: number }>,
): ServiceStatus {
  const weightTotals = new Map<ServiceStatus, number>();

  for (const child of children) {
    weightTotals.set(child.status, (weightTotals.get(child.status) ?? 0) + child.weight);
  }

  let maxWeight = -1;
  let winningStatus: ServiceStatus = 'unknown';
  let winningSeverity = -1;

  for (const [status, totalWeight] of weightTotals) {
    const severity = STATUS_SEVERITY[status] ?? 0;
    if (
      totalWeight > maxWeight ||
      (totalWeight === maxWeight && severity > winningSeverity)
    ) {
      maxWeight = totalWeight;
      winningStatus = status;
      winningSeverity = severity;
    }
  }

  return winningStatus;
}
