/**
 * StatusOwl — Service Group Repository
 *
 * CRUD operations for service groups.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, ServiceGroup } from '../core/index.js';

const log = createChildLogger('GroupRepo');

export interface CreateGroupInput {
  name: string;
  description?: string;
  sortOrder?: number;
  collapsed?: boolean;
}

export function createGroup(input: CreateGroupInput): Result<ServiceGroup> {
  try {
    const db = getDb();
    const id = randomUUID();

    db.prepare(`
      INSERT INTO service_groups (id, name, description, sort_order, collapsed)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? '',
      input.sortOrder ?? 0,
      (input.collapsed ?? false) ? 1 : 0,
    );

    log.info({ id, name: input.name }, 'Group created');
    return getGroup(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to create group');
    return err('CREATE_FAILED', msg);
  }
}

export function getGroup(id: string): Result<ServiceGroup> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM service_groups WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Group ${id} not found`);

    return ok(rowToGroup(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function listGroups(): Result<ServiceGroup[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM service_groups ORDER BY sort_order ASC, name ASC').all() as Record<string, unknown>[];
    return ok(rows.map(rowToGroup));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function updateGroup(id: string, updates: Partial<CreateGroupInput>): Result<ServiceGroup> {
  try {
    const db = getDb();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(updates.sortOrder); }
    if (updates.collapsed !== undefined) { fields.push('collapsed = ?'); params.push(updates.collapsed ? 1 : 0); }

    if (fields.length === 0) return getGroup(id);

    params.push(id);

    const result = db.prepare(`UPDATE service_groups SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    if (result.changes === 0) return err('NOT_FOUND', `Group ${id} not found`);

    log.info({ id, updates: Object.keys(updates) }, 'Group updated');
    return getGroup(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('UPDATE_FAILED', msg);
  }
}

export function deleteGroup(id: string): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM service_groups WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Group ${id} not found`);
    log.info({ id }, 'Group deleted');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DELETE_FAILED', msg);
  }
}

function rowToGroup(row: Record<string, unknown>): ServiceGroup {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    sortOrder: row.sort_order as number,
    collapsed: Boolean(row.collapsed),
    createdAt: row.created_at as string,
  };
}
