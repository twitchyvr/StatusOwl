/**
 * StatusOwl — Audit Log Repository
 */
import { randomUUID } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from '../storage/database.js';
import type { Result, AuditLogEntry, AuditAction } from '../core/index.js';

const log = createChildLogger('AuditLog');

function rowToEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row.id as string,
    action: row.action as AuditAction,
    resourceType: row.resource_type as string,
    resourceId: row.resource_id as string,
    actor: row.actor as string,
    detail: row.detail as string | null,
    createdAt: row.created_at as string,
  };
}

export function recordAudit(
  action: AuditAction,
  resourceType: string,
  resourceId: string,
  opts?: { actor?: string; detail?: string }
): Result<AuditLogEntry> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, action, resourceType, resourceId, opts?.actor ?? 'system', opts?.detail ?? null, now);

    return ok(rowToEntry({
      id, action, resource_type: resourceType, resource_id: resourceId,
      actor: opts?.actor ?? 'system', detail: opts?.detail ?? null, created_at: now,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to record audit entry');
    return err('DB_ERROR', msg);
  }
}

export function queryAuditLog(opts?: {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  offset?: number;
}): Result<{ entries: AuditLogEntry[]; total: number }> {
  try {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.action) { conditions.push('action = ?'); params.push(opts.action); }
    if (opts?.resourceType) { conditions.push('resource_type = ?'); params.push(opts.resourceType); }
    if (opts?.resourceId) { conditions.push('resource_id = ?'); params.push(opts.resourceId); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number };

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const rows = db.prepare(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return ok({ entries: rows.map(rowToEntry), total: totalRow.count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function purgeOldAuditEntries(maxAgeDays: number): Result<number> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString();
    const result = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff);
    log.info({ deleted: result.changes, maxAgeDays }, 'Purged old audit entries');
    return ok(result.changes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}
