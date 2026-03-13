/**
 * StatusOwl — Alert Policy Repository
 */

import { randomUUID } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from '../storage/database.js';
import type { Result, AlertPolicy, CreateAlertPolicy } from '../core/index.js';

const log = createChildLogger('AlertPolicyRepo');

function rowToPolicy(row: Record<string, unknown>): AlertPolicy {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    failureThreshold: row.failure_threshold as number,
    responseTimeThresholdMs: row.response_time_threshold_ms as number | null,
    cooldownMinutes: row.cooldown_minutes as number,
    enabled: (row.enabled as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createAlertPolicy(input: CreateAlertPolicy): Result<AlertPolicy> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO alert_policies (id, service_id, failure_threshold, response_time_threshold_ms, cooldown_minutes, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.serviceId, input.failureThreshold, input.responseTimeThresholdMs, input.cooldownMinutes, input.enabled ? 1 : 0, now, now);

    return getAlertPolicy(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to create alert policy');
    return err('DB_ERROR', msg);
  }
}

export function getAlertPolicy(id: string): Result<AlertPolicy> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM alert_policies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return err('NOT_FOUND', `Alert policy ${id} not found`);
    return ok(rowToPolicy(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function getAlertPolicyByService(serviceId: string): Result<AlertPolicy | null> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM alert_policies WHERE service_id = ?').get(serviceId) as Record<string, unknown> | undefined;
    return ok(row ? rowToPolicy(row) : null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function listAlertPolicies(): Result<AlertPolicy[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM alert_policies ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return ok(rows.map(rowToPolicy));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function updateAlertPolicy(id: string, updates: Partial<CreateAlertPolicy>): Result<AlertPolicy> {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM alert_policies WHERE id = ?').get(id);
    if (!existing) return err('NOT_FOUND', `Alert policy ${id} not found`);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.failureThreshold !== undefined) { sets.push('failure_threshold = ?'); values.push(updates.failureThreshold); }
    if (updates.responseTimeThresholdMs !== undefined) { sets.push('response_time_threshold_ms = ?'); values.push(updates.responseTimeThresholdMs); }
    if (updates.cooldownMinutes !== undefined) { sets.push('cooldown_minutes = ?'); values.push(updates.cooldownMinutes); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);
      db.prepare(`UPDATE alert_policies SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    return getAlertPolicy(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function deleteAlertPolicy(id: string): Result<{ deleted: true }> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM alert_policies WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Alert policy ${id} not found`);
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

// ── Cooldown management ──

export function isInCooldown(serviceId: string, cooldownMinutes: number): boolean {
  try {
    const db = getDb();
    const row = db.prepare('SELECT last_alert_at FROM alert_cooldowns WHERE service_id = ?').get(serviceId) as { last_alert_at: string } | undefined;
    if (!row) return false;

    const lastAlert = new Date(row.last_alert_at);
    const cooldownEnd = new Date(lastAlert.getTime() + cooldownMinutes * 60_000);
    return new Date() < cooldownEnd;
  } catch {
    return false;
  }
}

export function recordAlertTime(serviceId: string): void {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO alert_cooldowns (service_id, last_alert_at) VALUES (?, ?)
      ON CONFLICT(service_id) DO UPDATE SET last_alert_at = ?
    `).run(serviceId, now, now);
  } catch {
    // Non-critical, don't throw
  }
}
