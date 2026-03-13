/**
 * StatusOwl — SLA Target Repository
 *
 * CRUD operations for SLA targets. Each service can have at most one
 * SLA target (enforced by a UNIQUE index on service_id).
 */

import { randomUUID } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from '../storage/database.js';
import type { Result, SlaTarget, CreateSlaTarget } from '../core/index.js';

const log = createChildLogger('SlaRepo');

function rowToSlaTarget(row: Record<string, unknown>): SlaTarget {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    uptimeTarget: row.uptime_target as number,
    responseTimeTarget: row.response_time_target as number,
    evaluationPeriod: row.evaluation_period as 'monthly' | 'quarterly',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createSlaTarget(input: CreateSlaTarget): Result<SlaTarget> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO sla_targets (id, service_id, uptime_target, response_time_target, evaluation_period, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.serviceId,
      input.uptimeTarget,
      input.responseTimeTarget,
      input.evaluationPeriod,
      now,
      now,
    );

    return getSlaTarget(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to create SLA target');
    if (msg.includes('UNIQUE constraint failed')) {
      return err('DUPLICATE', `SLA target already exists for this service`);
    }
    return err('DB_ERROR', msg);
  }
}

export function getSlaTarget(id: string): Result<SlaTarget> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sla_targets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return err('NOT_FOUND', `SLA target ${id} not found`);
    return ok(rowToSlaTarget(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function getSlaTargetByService(serviceId: string): Result<SlaTarget | null> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sla_targets WHERE service_id = ?').get(serviceId) as Record<string, unknown> | undefined;
    return ok(row ? rowToSlaTarget(row) : null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function updateSlaTarget(id: string, updates: Partial<CreateSlaTarget>): Result<SlaTarget> {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM sla_targets WHERE id = ?').get(id);
    if (!existing) return err('NOT_FOUND', `SLA target ${id} not found`);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.uptimeTarget !== undefined) { sets.push('uptime_target = ?'); values.push(updates.uptimeTarget); }
    if (updates.responseTimeTarget !== undefined) { sets.push('response_time_target = ?'); values.push(updates.responseTimeTarget); }
    if (updates.evaluationPeriod !== undefined) { sets.push('evaluation_period = ?'); values.push(updates.evaluationPeriod); }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);
      db.prepare(`UPDATE sla_targets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    return getSlaTarget(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function deleteSlaTarget(id: string): Result<{ deleted: true }> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM sla_targets WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `SLA target ${id} not found`);
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function listSlaTargets(): Result<SlaTarget[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sla_targets ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return ok(rows.map(rowToSlaTarget));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}
