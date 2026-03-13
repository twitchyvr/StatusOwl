/**
 * StatusOwl — Daily Uptime Aggregator
 *
 * Computes daily uptime summaries from check_results and stores in uptime_daily.
 * Runs on startup to backfill missing days, then once every 24 hours.
 */

import { getDb } from '../storage/database.js';
import { aggregateDailyUptime } from '../storage/check-repo.js';
import { createChildLogger } from '../core/index.js';

const log = createChildLogger('DailyAggregator');

let _timer: NodeJS.Timeout | null = null;

/**
 * Start the daily aggregator. Backfills missing days on startup,
 * then runs once every 24 hours.
 */
export function startDailyAggregator(): void {
  if (_timer) return; // Already running

  // Backfill on startup
  backfillMissingDays();

  // Run every 24 hours
  _timer = setInterval(() => {
    aggregateYesterday();
  }, 24 * 60 * 60 * 1000);

  if (_timer.unref) _timer.unref();

  log.info('Daily aggregator started');
}

export function stopDailyAggregator(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log.info('Daily aggregator stopped');
  }
}

/**
 * Aggregate yesterday's data for all services.
 */
function aggregateYesterday(): void {
  const yesterday = getDateString(-1);
  aggregateAllServicesForDate(yesterday);
}

/**
 * Backfill any missing days in the last 90 days.
 */
function backfillMissingDays(): void {
  const db = getDb();

  // Get all service IDs
  const services = db.prepare('SELECT id FROM services').all() as { id: string }[];
  if (services.length === 0) return;

  // Find the oldest check date
  const oldest = db.prepare(`
    SELECT MIN(date(checked_at)) as min_date FROM check_results
  `).get() as { min_date: string | null };

  if (!oldest?.min_date) return;

  const today = getDateString(0);
  let current = oldest.min_date;

  // Don't go back more than 90 days
  const ninetyDaysAgo = getDateString(-90);
  if (current < ninetyDaysAgo) current = ninetyDaysAgo;

  let backfilledCount = 0;

  while (current < today) {
    for (const svc of services) {
      // Check if this day is already aggregated
      const exists = db.prepare(
        'SELECT 1 FROM uptime_daily WHERE service_id = ? AND date = ?'
      ).get(svc.id, current);

      if (!exists) {
        const result = aggregateDailyUptime(svc.id, current);
        if (result.ok) backfilledCount++;
      }
    }
    current = nextDay(current);
  }

  if (backfilledCount > 0) {
    log.info({ backfilledCount }, 'Backfilled missing daily aggregates');
  }
}

/**
 * Aggregate a specific date for all services.
 */
function aggregateAllServicesForDate(date: string): void {
  const db = getDb();
  const services = db.prepare('SELECT id FROM services').all() as { id: string }[];

  for (const svc of services) {
    aggregateDailyUptime(svc.id, date);
  }

  log.debug({ date, serviceCount: services.length }, 'Aggregated daily uptime');
}

function getDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
