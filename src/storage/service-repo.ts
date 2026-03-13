/**
 * StatusOwl — Service Repository
 *
 * CRUD operations for monitored services.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import { decodeCursor } from '../api/pagination.js';
import type { Result, Service, CreateService, ServiceStatus, BodyValidation } from '../core/index.js';

const log = createChildLogger('ServiceRepo');

export function createService(input: CreateService): Result<Service> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO services (id, name, url, method, check_type, expected_status, check_interval, timeout, headers, body, body_validation, status, enabled, group_id, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.url,
      input.method ?? 'GET',
      input.checkType ?? 'http',
      input.expectedStatus ?? 200,
      input.checkInterval ?? 60,
      input.timeout ?? 10,
      input.headers ? JSON.stringify(input.headers) : null,
      input.body ?? null,
      input.bodyValidation ? JSON.stringify(input.bodyValidation) : null,
      (input.enabled ?? true) ? 1 : 0,
      input.groupId ?? null,
      input.sortOrder ?? 0,
      now,
      now,
    );

    log.info({ id, name: input.name, url: input.url }, 'Service created');
    return getService(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to create service');
    return err('CREATE_FAILED', msg);
  }
}

export function getService(id: string): Result<Service> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Service ${id} not found`);

    return ok(rowToService(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function listServices(opts?: { enabled?: boolean; groupId?: string | null }): Result<Service[]> {
  try {
    const db = getDb();
    let sql = 'SELECT * FROM services WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(opts.enabled ? 1 : 0);
    }
    if (opts?.groupId !== undefined) {
      if (opts.groupId === null) {
        sql += ' AND group_id IS NULL';
      } else {
        sql += ' AND group_id = ?';
        params.push(opts.groupId);
      }
    }

    sql += ' ORDER BY sort_order ASC, name ASC';

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return ok(rows.map(rowToService));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

/**
 * List services with cursor-based pagination and filtering.
 * Returns limit+1 rows so the caller can determine if there are more results.
 */
export function listServicesPaginated(opts?: {
  enabled?: boolean;
  status?: string;
  groupId?: string;
  cursor?: string;
  limit?: number;
}): Result<{ services: Service[]; total: number }> {
  try {
    const db = getDb();
    const limit = opts?.limit ?? 20;

    // Build filter conditions (shared between count and data queries)
    const filterConditions: string[] = [];
    const filterParams: unknown[] = [];

    if (opts?.enabled !== undefined) {
      filterConditions.push('enabled = ?');
      filterParams.push(opts.enabled ? 1 : 0);
    }
    if (opts?.status) {
      filterConditions.push('status = ?');
      filterParams.push(opts.status);
    }
    if (opts?.groupId) {
      filterConditions.push('group_id = ?');
      filterParams.push(opts.groupId);
    }

    // Count total matching the filters (without cursor/limit)
    const countWhere = filterConditions.length > 0 ? `WHERE ${filterConditions.join(' AND ')}` : '';
    const totalRow = db.prepare(
      `SELECT COUNT(*) as count FROM services ${countWhere}`
    ).get(...filterParams) as { count: number };

    // Build data query conditions (filters + cursor)
    const dataConditions = [...filterConditions];
    const dataParams = [...filterParams];

    if (opts?.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        dataConditions.push('(created_at < ? OR (created_at = ? AND id > ?))');
        dataParams.push(decoded.sortValue, decoded.sortValue, decoded.id);
      }
    }

    const dataWhere = dataConditions.length > 0 ? `WHERE ${dataConditions.join(' AND ')}` : '';

    // Fetch limit + 1 to check if there are more results
    const rows = db.prepare(
      `SELECT * FROM services ${dataWhere} ORDER BY created_at DESC, id ASC LIMIT ?`
    ).all(...dataParams, limit + 1) as Record<string, unknown>[];

    return ok({ services: rows.map(rowToService), total: totalRow.count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to list services (paginated)');
    return err('DB_ERROR', msg);
  }
}

/**
 * Get multiple services by their IDs.
 */
export function getServicesByIds(ids: string[]): Result<Service[]> {
  if (ids.length === 0) {
    return ok([]);
  }

  try {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM services WHERE id IN (${placeholders})`
    ).all(...ids) as Record<string, unknown>[];

    return ok(rows.map(rowToService));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function updateService(id: string, updates: Partial<CreateService>): Result<Service> {
  try {
    const db = getDb();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.url !== undefined) { fields.push('url = ?'); params.push(updates.url); }
    if (updates.method !== undefined) { fields.push('method = ?'); params.push(updates.method); }
    if (updates.checkType !== undefined) { fields.push('check_type = ?'); params.push(updates.checkType); }
    if (updates.expectedStatus !== undefined) { fields.push('expected_status = ?'); params.push(updates.expectedStatus); }
    if (updates.checkInterval !== undefined) { fields.push('check_interval = ?'); params.push(updates.checkInterval); }
    if (updates.timeout !== undefined) { fields.push('timeout = ?'); params.push(updates.timeout); }
    if (updates.headers !== undefined) { fields.push('headers = ?'); params.push(JSON.stringify(updates.headers)); }
    if (updates.body !== undefined) { fields.push('body = ?'); params.push(updates.body); }
    if (updates.bodyValidation !== undefined) { fields.push('body_validation = ?'); params.push(JSON.stringify(updates.bodyValidation)); }
    if (updates.enabled !== undefined) { fields.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    if (updates.groupId !== undefined) { fields.push('group_id = ?'); params.push(updates.groupId); }
    if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(updates.sortOrder); }

    if (fields.length === 0) return getService(id);

    fields.push("updated_at = datetime('now')");
    params.push(id);

    const result = db.prepare(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    if (result.changes === 0) return err('NOT_FOUND', `Service ${id} not found`);

    log.info({ id, updates: Object.keys(updates) }, 'Service updated');
    return getService(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('UPDATE_FAILED', msg);
  }
}

export function updateServiceStatus(id: string, status: ServiceStatus): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare("UPDATE services SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    if (result.changes === 0) return err('NOT_FOUND', `Service ${id} not found`);
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('UPDATE_FAILED', msg);
  }
}

export function deleteService(id: string): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM services WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Service ${id} not found`);
    log.info({ id }, 'Service deleted');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DELETE_FAILED', msg);
  }
}

function rowToService(row: Record<string, unknown>): Service {
  let headers: Record<string, string> | undefined;
  if (row.headers) {
    try {
      headers = JSON.parse(row.headers as string);
    } catch {
      log.warn({ serviceId: row.id, raw: row.headers }, 'Invalid JSON in headers column, ignoring');
      headers = undefined;
    }
  }

  let bodyValidation: BodyValidation | undefined;
  if (row.body_validation) {
    try {
      bodyValidation = JSON.parse(row.body_validation as string);
    } catch {
      log.warn({ serviceId: row.id, raw: row.body_validation }, 'Invalid JSON in body_validation column, ignoring');
      bodyValidation = undefined;
    }
  }

  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    method: (row.method as 'GET' | 'HEAD' | 'POST') ?? 'GET',
    checkType: (row.check_type as 'http' | 'tcp' | 'dns') ?? 'http',
    expectedStatus: row.expected_status as number,
    checkInterval: row.check_interval as number,
    timeout: row.timeout as number,
    headers,
    body: row.body as string | undefined,
    bodyValidation,
    status: row.status as ServiceStatus,
    enabled: Boolean(row.enabled),
    groupId: (row.group_id as string) ?? null,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
