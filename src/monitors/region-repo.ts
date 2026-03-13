/**
 * StatusOwl — Monitoring Region Repository
 */

import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from '../storage/database.js';
import type { Result, MonitoringRegion } from '../core/index.js';

const log = createChildLogger('RegionRepo');

function rowToRegion(row: Record<string, unknown>): MonitoringRegion {
  return {
    id: row.id as string,
    name: row.name as string,
    location: row.location as string,
    enabled: (row.enabled as number) === 1,
  };
}

export function createRegion(id: string, name: string, location?: string): Result<MonitoringRegion> {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO monitoring_regions (id, name, location) VALUES (?, ?, ?)'
    ).run(id, name, location ?? '');
    log.info({ id, name }, 'Region created');
    return ok({ id, name, location: location ?? '', enabled: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint') || msg.includes('PRIMARY KEY')) {
      return err('DUPLICATE', `Region ${id} already exists`);
    }
    return err('DB_ERROR', msg);
  }
}

export function listRegions(): Result<MonitoringRegion[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM monitoring_regions ORDER BY name').all() as Record<string, unknown>[];
    return ok(rows.map(rowToRegion));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function getRegion(id: string): Result<MonitoringRegion> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM monitoring_regions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return err('NOT_FOUND', `Region ${id} not found`);
    return ok(rowToRegion(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function deleteRegion(id: string): Result<{ deleted: true }> {
  try {
    if (id === 'default') return err('VALIDATION', 'Cannot delete the default region');
    const db = getDb();
    const result = db.prepare('DELETE FROM monitoring_regions WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Region ${id} not found`);
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

/**
 * Get per-region latency breakdown for a service.
 */
export function getRegionalLatency(serviceId: string, hours: number = 24): Result<Array<{
  regionId: string;
  regionName: string;
  avgResponseTime: number;
  checkCount: number;
}>> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

    const rows = db.prepare(`
      SELECT
        cr.region_id,
        mr.name as region_name,
        AVG(cr.response_time) as avg_response_time,
        COUNT(*) as check_count
      FROM check_results cr
      LEFT JOIN monitoring_regions mr ON cr.region_id = mr.id
      WHERE cr.service_id = ? AND cr.checked_at > ?
      GROUP BY cr.region_id
      ORDER BY avg_response_time
    `).all(serviceId, cutoff) as Array<{
      region_id: string;
      region_name: string;
      avg_response_time: number;
      check_count: number;
    }>;

    return ok(rows.map(r => ({
      regionId: r.region_id,
      regionName: r.region_name ?? r.region_id,
      avgResponseTime: Math.round(r.avg_response_time * 100) / 100,
      checkCount: r.check_count,
    })));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}
