/**
 * StatusOwl — Check Result Repository
 *
 * Stores and queries health check results.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, CheckResult, ServiceStatus, UptimeSummary } from '../core/index.js';

const log = createChildLogger('CheckRepo');

export function recordCheck(serviceId: string, status: ServiceStatus, responseTime: number, statusCode: number | null, errorMessage: string | null, regionId?: string): Result<CheckResult> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO check_results (id, service_id, status, response_time, status_code, error_message, checked_at, region_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, serviceId, status, responseTime, statusCode, errorMessage, now, regionId ?? 'default');

    return ok({ id, serviceId, status, responseTime, statusCode, errorMessage, checkedAt: now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ serviceId, error: msg }, 'Failed to record check');
    return err('INSERT_FAILED', msg);
  }
}

export function getRecentChecks(serviceId: string, limit = 50): Result<CheckResult[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM check_results
      WHERE service_id = ?
      ORDER BY checked_at DESC, ROWID DESC
      LIMIT ?
    `).all(serviceId, limit) as Record<string, unknown>[];

    return ok(rows.map(rowToCheck));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function getUptimeSummary(serviceId: string, period: '24h' | '7d' | '30d' | '90d'): Result<UptimeSummary> {
  try {
    const db = getDb();
    const hoursMap = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
    const hours = hoursMap[period];

    const row = db.prepare(`
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'operational' THEN 1 ELSE 0 END) as successful_checks,
        AVG(response_time) as avg_response_time
      FROM check_results
      WHERE service_id = ?
        AND checked_at >= datetime('now', '-${hours} hours')
    `).get(serviceId) as Record<string, unknown>;

    const total = (row.total_checks as number) || 0;
    const successful = (row.successful_checks as number) || 0;

    return ok({
      serviceId,
      period,
      totalChecks: total,
      successfulChecks: successful,
      uptimePercent: total > 0 ? (successful / total) * 100 : 100,
      avgResponseTime: (row.avg_response_time as number) || 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function pruneOldChecks(olderThanDays = 90): Result<number> {
  try {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM check_results
      WHERE checked_at < datetime('now', '-${olderThanDays} days')
    `).run();

    if (result.changes > 0) {
      log.info({ pruned: result.changes, olderThanDays }, 'Pruned old check results');
    }
    return ok(result.changes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('PRUNE_FAILED', msg);
  }
}

export interface DailyUptimeRecord {
  date: string;
  totalChecks: number;
  successfulChecks: number;
  avgResponseTime: number;
  uptimePercent: number;
}

/**
 * Aggregate a single day's check results into the uptime_daily table.
 * Uses UPSERT to handle re-runs safely.
 */
export function aggregateDailyUptime(serviceId: string, date: string): Result<void> {
  try {
    const db = getDb();

    const row = db.prepare(`
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'operational' THEN 1 ELSE 0 END) as successful_checks,
        AVG(response_time) as avg_response_time
      FROM check_results
      WHERE service_id = ?
        AND date(checked_at) = ?
    `).get(serviceId, date) as Record<string, unknown>;

    const total = (row.total_checks as number) || 0;
    if (total === 0) return ok(undefined); // No checks for this day

    db.prepare(`
      INSERT INTO uptime_daily (service_id, date, total_checks, successful_checks, avg_response_time)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(service_id, date)
      DO UPDATE SET
        total_checks = excluded.total_checks,
        successful_checks = excluded.successful_checks,
        avg_response_time = excluded.avg_response_time
    `).run(
      serviceId,
      date,
      total,
      (row.successful_checks as number) || 0,
      (row.avg_response_time as number) || 0,
    );

    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('AGGREGATION_FAILED', msg);
  }
}

/**
 * Get daily uptime history for a service over the last N days.
 */
export function getDailyHistory(serviceId: string, days = 90): Result<DailyUptimeRecord[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM uptime_daily
      WHERE service_id = ?
        AND date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(serviceId, days) as Record<string, unknown>[];

    return ok(rows.map(row => {
      const total = (row.total_checks as number) || 0;
      const successful = (row.successful_checks as number) || 0;
      return {
        date: row.date as string,
        totalChecks: total,
        successfulChecks: successful,
        avgResponseTime: (row.avg_response_time as number) || 0,
        uptimePercent: total > 0 ? (successful / total) * 100 : 100,
      };
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

function rowToCheck(row: Record<string, unknown>): CheckResult {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    status: row.status as ServiceStatus,
    responseTime: row.response_time as number,
    statusCode: row.status_code as number | null,
    errorMessage: row.error_message as string | null,
    checkedAt: row.checked_at as string,
  };
}
