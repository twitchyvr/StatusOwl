/**
 * StatusOwl — Tag Repository
 *
 * CRUD operations for service tags/labels and service-tag associations.
 * Supports filtering services by tags in AND/OR modes.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, Tag, ServiceTag } from '../core/index.js';

const log = createChildLogger('TagRepo');

/** Predefined color palette for tags when no color is specified. */
const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
];

/** Track how many tags have been created to rotate through default colors. */
function nextDefaultColor(): string {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM tags').get() as { count: number };
  return DEFAULT_COLORS[row.count % DEFAULT_COLORS.length];
}

function rowToTag(row: Record<string, unknown>): Tag {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    createdAt: row.created_at as string,
  };
}

function rowToServiceTag(row: Record<string, unknown>): ServiceTag {
  return {
    serviceId: row.service_id as string,
    tagId: row.tag_id as string,
  };
}

// ── Tag CRUD ──

export function createTag(name: string, color?: string): Result<Tag> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const tagColor = color ?? nextDefaultColor();

    db.prepare(`
      INSERT INTO tags (id, name, color, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name.trim(), tagColor, now);

    log.info({ id, name, color: tagColor }, 'Tag created');
    return ok({ id, name: name.trim(), color: tagColor, createdAt: now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint')) {
      return err('DUPLICATE', `Tag "${name}" already exists`);
    }
    log.error({ error: msg }, 'Failed to create tag');
    return err('CREATE_FAILED', msg);
  }
}

export function getTag(id: string): Result<Tag> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Tag ${id} not found`);

    return ok(rowToTag(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function listTags(): Result<Tag[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM tags ORDER BY name ASC').all() as Record<string, unknown>[];
    return ok(rows.map(rowToTag));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to list tags');
    return err('QUERY_FAILED', msg);
  }
}

export function deleteTag(id: string): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Tag ${id} not found`);
    log.info({ id }, 'Tag deleted');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to delete tag');
    return err('DELETE_FAILED', msg);
  }
}

// ── Service-Tag Associations ──

export function addTagToService(serviceId: string, tagId: string): Result<ServiceTag> {
  try {
    const db = getDb();

    db.prepare(`
      INSERT INTO service_tags (service_id, tag_id)
      VALUES (?, ?)
    `).run(serviceId, tagId);

    log.info({ serviceId, tagId }, 'Tag added to service');
    return ok({ serviceId, tagId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint') || msg.includes('PRIMARY KEY')) {
      return err('DUPLICATE', 'This tag is already assigned to the service');
    }
    if (msg.includes('FOREIGN KEY constraint')) {
      return err('NOT_FOUND', 'Service or tag not found');
    }
    log.error({ error: msg }, 'Failed to add tag to service');
    return err('CREATE_FAILED', msg);
  }
}

export function removeTagFromService(serviceId: string, tagId: string): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM service_tags WHERE service_id = ? AND tag_id = ?').run(serviceId, tagId);
    if (result.changes === 0) return err('NOT_FOUND', 'Tag is not assigned to this service');
    log.info({ serviceId, tagId }, 'Tag removed from service');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to remove tag from service');
    return err('DELETE_FAILED', msg);
  }
}

export function getTagsForService(serviceId: string): Result<Tag[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN service_tags st ON st.tag_id = t.id
      WHERE st.service_id = ?
      ORDER BY t.name ASC
    `).all(serviceId) as Record<string, unknown>[];

    return ok(rows.map(rowToTag));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to get tags for service');
    return err('QUERY_FAILED', msg);
  }
}

// ── Query: Filter Services by Tags ──

/**
 * Get service IDs that match the given tag IDs.
 *
 * @param tagIds - Array of tag IDs to filter by.
 * @param mode - 'or' returns services matching ANY tag, 'and' returns services matching ALL tags.
 * @returns Array of service IDs matching the filter criteria.
 */
export function getServicesByTag(tagIds: string[], mode: 'and' | 'or'): Result<string[]> {
  if (tagIds.length === 0) {
    return ok([]);
  }

  try {
    const db = getDb();
    const placeholders = tagIds.map(() => '?').join(',');

    if (mode === 'or') {
      // OR mode: return services that have at least one of the specified tags
      const rows = db.prepare(`
        SELECT DISTINCT service_id
        FROM service_tags
        WHERE tag_id IN (${placeholders})
        ORDER BY service_id
      `).all(...tagIds) as { service_id: string }[];

      return ok(rows.map(r => r.service_id));
    }

    // AND mode: return services that have ALL of the specified tags
    const rows = db.prepare(`
      SELECT service_id
      FROM service_tags
      WHERE tag_id IN (${placeholders})
      GROUP BY service_id
      HAVING COUNT(DISTINCT tag_id) = ?
      ORDER BY service_id
    `).all(...tagIds, tagIds.length) as { service_id: string }[];

    return ok(rows.map(r => r.service_id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, tagIds, mode }, 'Failed to get services by tag');
    return err('QUERY_FAILED', msg);
  }
}
