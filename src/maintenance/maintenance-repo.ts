/**
 * StatusOwl — Maintenance Window Repository
 *
 * CRUD operations for scheduled maintenance windows.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, MaintenanceWindow, CreateMaintenanceWindow } from '../core/index.js';

const log = createChildLogger('MaintenanceRepo');

export function createMaintenanceWindow(input: CreateMaintenanceWindow): Result<MaintenanceWindow> {
  try {
    const db = getDb();
    const id = randomUUID();

    // Validate end is after start
    if (new Date(input.endAt) <= new Date(input.startAt)) {
      return err('VALIDATION', 'endAt must be after startAt');
    }

    db.prepare(`
      INSERT INTO maintenance_windows (id, service_id, title, start_at, end_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.serviceId, input.title, input.startAt, input.endAt);

    log.info({ id, serviceId: input.serviceId, title: input.title }, 'Maintenance window created');
    return getMaintenanceWindow(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to create maintenance window');
    return err('CREATE_FAILED', msg);
  }
}

export function getMaintenanceWindow(id: string): Result<MaintenanceWindow> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Maintenance window ${id} not found`);
    return ok(rowToWindow(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function listMaintenanceWindows(opts?: { serviceId?: string; active?: boolean }): Result<MaintenanceWindow[]> {
  try {
    const db = getDb();
    let sql = 'SELECT * FROM maintenance_windows WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.serviceId) {
      sql += ' AND service_id = ?';
      params.push(opts.serviceId);
    }
    if (opts?.active) {
      const now = new Date().toISOString();
      sql += ' AND start_at <= ? AND end_at >= ?';
      params.push(now, now);
    }

    sql += ' ORDER BY start_at ASC';

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return ok(rows.map(rowToWindow));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Check if a service is currently in a maintenance window.
 */
export function isInMaintenanceWindow(serviceId: string): boolean {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const row = db.prepare(`
      SELECT 1 FROM maintenance_windows
      WHERE service_id = ?
        AND start_at <= ?
        AND end_at >= ?
      LIMIT 1
    `).get(serviceId, now, now);

    return row !== undefined;
  } catch {
    return false;
  }
}

export function deleteMaintenanceWindow(id: string): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM maintenance_windows WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Maintenance window ${id} not found`);
    log.info({ id }, 'Maintenance window deleted');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DELETE_FAILED', msg);
  }
}

function rowToWindow(row: Record<string, unknown>): MaintenanceWindow {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    title: row.title as string,
    startAt: row.start_at as string,
    endAt: row.end_at as string,
    createdAt: row.created_at as string,
  };
}
