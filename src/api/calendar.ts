/**
 * StatusOwl — Calendar Data Provider
 *
 * Generates GitHub-contribution-graph-style calendar data from
 * uptime_daily and incidents tables.
 */

import { getDb } from '../storage/database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result } from '../core/index.js';

const log = createChildLogger('Calendar');

// ── Types ──

export interface CalendarDay {
  date: string;
  uptimePercent: number;
  totalChecks: number;
  successfulChecks: number;
  avgResponseTime: number;
  incidentCount: number;
  /** 0 = worst (<90%), 1 = poor (>=90%), 2 = fair (>=95%), 3 = good (>=99%), 4 = excellent (>99.9%) */
  level: 0 | 1 | 2 | 3 | 4;
}

// ── Level mapping ──

/**
 * Map an uptime percentage to a 0-4 level for the calendar heat map.
 *
 * Level 4: > 99.9%  (excellent)
 * Level 3: > 99%    (good)
 * Level 2: > 95%    (fair)
 * Level 1: > 90%    (poor)
 * Level 0: <= 90%   (bad)
 *
 * When there are zero checks for a day the uptime defaults to 100%
 * (matching the convention used elsewhere in the codebase).
 */
export function uptimeToLevel(uptimePercent: number): 0 | 1 | 2 | 3 | 4 {
  if (uptimePercent > 99.9) return 4;
  if (uptimePercent > 99) return 3;
  if (uptimePercent > 95) return 2;
  if (uptimePercent > 90) return 1;
  return 0;
}

// ── Per-service calendar ──

/**
 * Build calendar data for a single service over the last `days` days.
 *
 * Returns one CalendarDay per calendar day in ascending date order.
 * Days without uptime_daily rows get uptimePercent 100 and totalChecks 0.
 */
export function getCalendarData(serviceId: string, days = 90): Result<CalendarDay[]> {
  try {
    const db = getDb();

    // Fetch daily uptime records for the requested window
    const uptimeRows = db.prepare(`
      SELECT date, total_checks, successful_checks, avg_response_time
      FROM uptime_daily
      WHERE service_id = ?
        AND date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(serviceId, days) as Array<{
      date: string;
      total_checks: number;
      successful_checks: number;
      avg_response_time: number;
    }>;

    // Build a map for fast lookups
    const uptimeMap = new Map<string, {
      totalChecks: number;
      successfulChecks: number;
      avgResponseTime: number;
    }>();
    for (const row of uptimeRows) {
      uptimeMap.set(row.date, {
        totalChecks: row.total_checks ?? 0,
        successfulChecks: row.successful_checks ?? 0,
        avgResponseTime: row.avg_response_time ?? 0,
      });
    }

    // Fetch incident counts per day for this service
    const incidentRows = db.prepare(`
      SELECT date(i.created_at) AS date, COUNT(DISTINCT i.id) AS incident_count
      FROM incidents i
      JOIN incident_services isvc ON i.id = isvc.incident_id
      WHERE isvc.service_id = ?
        AND date(i.created_at) >= date('now', '-' || ? || ' days')
      GROUP BY date(i.created_at)
    `).all(serviceId, days) as Array<{ date: string; incident_count: number }>;

    const incidentMap = new Map<string, number>();
    for (const row of incidentRows) {
      incidentMap.set(row.date, row.incident_count);
    }

    // Generate a CalendarDay for every date in the window
    const result: CalendarDay[] = [];
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);

      const uptime = uptimeMap.get(dateStr);
      const totalChecks = uptime?.totalChecks ?? 0;
      const successfulChecks = uptime?.successfulChecks ?? 0;
      const avgResponseTime = uptime?.avgResponseTime ?? 0;
      const uptimePercent = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 100;
      const incidentCount = incidentMap.get(dateStr) ?? 0;

      result.push({
        date: dateStr,
        uptimePercent,
        totalChecks,
        successfulChecks,
        avgResponseTime,
        incidentCount,
        level: uptimeToLevel(uptimePercent),
      });
    }

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ serviceId, error: msg }, 'Failed to build calendar data');
    return err('QUERY_FAILED', msg);
  }
}

// ── Overall (all-services) calendar ──

/**
 * Aggregate calendar data across every service for the last `days` days.
 *
 * For each calendar day the uptime percentage is calculated as the weighted
 * average across all services (total successful checks / total checks).
 * Incident counts are the distinct incidents created on that day across
 * all services.
 */
export function getOverallCalendarData(days = 90): Result<CalendarDay[]> {
  try {
    const db = getDb();

    // Aggregate uptime across all services per day
    const uptimeRows = db.prepare(`
      SELECT date,
             SUM(total_checks)      AS total_checks,
             SUM(successful_checks) AS successful_checks,
             AVG(avg_response_time) AS avg_response_time
      FROM uptime_daily
      WHERE date >= date('now', '-' || ? || ' days')
      GROUP BY date
      ORDER BY date ASC
    `).all(days) as Array<{
      date: string;
      total_checks: number;
      successful_checks: number;
      avg_response_time: number;
    }>;

    const uptimeMap = new Map<string, {
      totalChecks: number;
      successfulChecks: number;
      avgResponseTime: number;
    }>();
    for (const row of uptimeRows) {
      uptimeMap.set(row.date, {
        totalChecks: row.total_checks ?? 0,
        successfulChecks: row.successful_checks ?? 0,
        avgResponseTime: row.avg_response_time ?? 0,
      });
    }

    // Aggregate incident counts per day (distinct incidents)
    const incidentRows = db.prepare(`
      SELECT date(created_at) AS date, COUNT(DISTINCT id) AS incident_count
      FROM incidents
      WHERE date(created_at) >= date('now', '-' || ? || ' days')
      GROUP BY date(created_at)
    `).all(days) as Array<{ date: string; incident_count: number }>;

    const incidentMap = new Map<string, number>();
    for (const row of incidentRows) {
      incidentMap.set(row.date, row.incident_count);
    }

    // Build CalendarDay array
    const result: CalendarDay[] = [];
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);

      const uptime = uptimeMap.get(dateStr);
      const totalChecks = uptime?.totalChecks ?? 0;
      const successfulChecks = uptime?.successfulChecks ?? 0;
      const avgResponseTime = uptime?.avgResponseTime ?? 0;
      const uptimePercent = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 100;
      const incidentCount = incidentMap.get(dateStr) ?? 0;

      result.push({
        date: dateStr,
        uptimePercent,
        totalChecks,
        successfulChecks,
        avgResponseTime,
        incidentCount,
        level: uptimeToLevel(uptimePercent),
      });
    }

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to build overall calendar data');
    return err('QUERY_FAILED', msg);
  }
}
