/**
 * StatusOwl — Report Generator
 *
 * Generates daily and weekly uptime summary reports.
 */

import { randomUUID } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from '../storage/database.js';
import { listServices, getUptimeSummary } from '../storage/index.js';
import type { Result, UptimeReport } from '../core/index.js';

const log = createChildLogger('ReportGenerator');

interface ServiceReportData {
  serviceId: string;
  serviceName: string;
  uptimePercent: number;
  totalChecks: number;
  successfulChecks: number;
  avgResponseTime: number;
}

function rowToReport(row: Record<string, unknown>): UptimeReport {
  return {
    id: row.id as string,
    period: row.period as 'daily' | 'weekly',
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    data: JSON.parse(row.data as string),
    generatedAt: row.generated_at as string,
  };
}

/**
 * Generate a report for the specified period.
 */
export function generateReport(period: 'daily' | 'weekly'): Result<UptimeReport> {
  try {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];

    let startDate: string;
    if (period === 'daily') {
      const yesterday = new Date(now.getTime() - 86400_000);
      startDate = yesterday.toISOString().split('T')[0];
    } else {
      const weekAgo = new Date(now.getTime() - 7 * 86400_000);
      startDate = weekAgo.toISOString().split('T')[0];
    }

    // Get all enabled services
    const servicesResult = listServices({ enabled: true });
    if (!servicesResult.ok) return err('INTERNAL', 'Failed to load services');

    const services = servicesResult.data;
    const serviceStats: ServiceReportData[] = [];

    const uptimePeriod = period === 'daily' ? '24h' : '7d';

    for (const service of services) {
      const uptimeResult = getUptimeSummary(service.id, uptimePeriod);
      if (uptimeResult.ok) {
        serviceStats.push({
          serviceId: service.id,
          serviceName: service.name,
          uptimePercent: uptimeResult.data.uptimePercent,
          totalChecks: uptimeResult.data.totalChecks,
          successfulChecks: uptimeResult.data.successfulChecks,
          avgResponseTime: uptimeResult.data.avgResponseTime,
        });
      }
    }

    // Calculate overall stats
    const overallUptime = serviceStats.length > 0
      ? serviceStats.reduce((sum, s) => sum + s.uptimePercent, 0) / serviceStats.length
      : 100;

    const reportData = {
      overallUptime: Math.round(overallUptime * 100) / 100,
      serviceCount: services.length,
      services: serviceStats,
    };

    // Store report
    const db = getDb();
    const id = randomUUID();
    const generatedAt = now.toISOString();

    db.prepare(`
      INSERT INTO uptime_reports (id, period, start_date, end_date, data, generated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, period, startDate, endDate, JSON.stringify(reportData), generatedAt);

    log.info({ period, startDate, endDate, serviceCount: services.length }, 'Report generated');

    return ok({
      id, period, startDate, endDate, data: reportData, generatedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to generate report');
    return err('INTERNAL', msg);
  }
}

/**
 * Get a report by ID.
 */
export function getReport(id: string): Result<UptimeReport> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM uptime_reports WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return err('NOT_FOUND', `Report ${id} not found`);
    return ok(rowToReport(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

/**
 * List reports with optional filtering.
 */
export function listReports(opts?: { period?: string; limit?: number }): Result<UptimeReport[]> {
  try {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.period) { conditions.push('period = ?'); params.push(opts.period); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts?.limit ?? 30;

    const rows = db.prepare(
      `SELECT * FROM uptime_reports ${where} ORDER BY generated_at DESC LIMIT ?`
    ).all(...params, limit) as Record<string, unknown>[];

    return ok(rows.map(rowToReport));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

// ── Background scheduler ──

let _dailyTimer: NodeJS.Timeout | null = null;

export function startReportScheduler(): void {
  // Generate daily report immediately on startup (covers yesterday)
  generateReport('daily');

  // Schedule daily report generation (every 24 hours)
  _dailyTimer = setInterval(() => {
    generateReport('daily');

    // Also generate weekly report on Mondays
    if (new Date().getDay() === 1) {
      generateReport('weekly');
    }
  }, 24 * 60 * 60_000);

  if (_dailyTimer.unref) _dailyTimer.unref();
  log.info('Report scheduler started');
}

export function stopReportScheduler(): void {
  if (_dailyTimer) {
    clearInterval(_dailyTimer);
    _dailyTimer = null;
  }
  log.info('Report scheduler stopped');
}
