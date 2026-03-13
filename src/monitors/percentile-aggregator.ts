/**
 * StatusOwl — Response Time Percentile Aggregator
 *
 * Computes p50, p95, p99 response time percentiles from check_results.
 * Runs hourly to populate the response_time_buckets table.
 */

import { getDb } from '../storage/database.js';
import { createChildLogger } from '../core/index.js';
import type { Result } from '../core/index.js';
import { ok, err } from '../core/index.js';

const log = createChildLogger('PercentileAggregator');

let _timer: NodeJS.Timeout | null = null;

export interface PercentileBucket {
  serviceId: string;
  hour: string;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  sampleCount: number;
}

/**
 * Compute a percentile from a sorted array of numbers.
 * Uses the nearest-rank method.
 */
export function computePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Aggregate percentiles for a specific service and hour.
 */
export function aggregateHourlyPercentiles(serviceId: string, hour: string): Result<PercentileBucket | null> {
  try {
    const db = getDb();

    // Get all response times for this service in this hour
    const rows = db.prepare(`
      SELECT response_time FROM check_results
      WHERE service_id = ?
        AND checked_at >= ?
        AND checked_at < datetime(?, '+1 hour')
        AND response_time > 0
      ORDER BY response_time ASC
    `).all(serviceId, hour, hour) as { response_time: number }[];

    if (rows.length === 0) return ok(null);

    const times = rows.map(r => r.response_time);

    const bucket: PercentileBucket = {
      serviceId,
      hour,
      p50: computePercentile(times, 50),
      p95: computePercentile(times, 95),
      p99: computePercentile(times, 99),
      min: times[0],
      max: times[times.length - 1],
      sampleCount: times.length,
    };

    // Upsert into response_time_buckets
    db.prepare(`
      INSERT INTO response_time_buckets (service_id, hour, p50, p95, p99, min, max, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_id, hour)
      DO UPDATE SET
        p50 = excluded.p50,
        p95 = excluded.p95,
        p99 = excluded.p99,
        min = excluded.min,
        max = excluded.max,
        sample_count = excluded.sample_count
    `).run(serviceId, hour, bucket.p50, bucket.p95, bucket.p99, bucket.min, bucket.max, bucket.sampleCount);

    return ok(bucket);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('AGGREGATION_FAILED', msg);
  }
}

/**
 * Get percentile data for a service over a time period.
 */
export function getPercentiles(serviceId: string, hours = 24): Result<PercentileBucket[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM response_time_buckets
      WHERE service_id = ?
        AND hour >= datetime('now', '-' || ? || ' hours')
      ORDER BY hour ASC
    `).all(serviceId, hours) as Record<string, unknown>[];

    return ok(rows.map(row => ({
      serviceId: row.service_id as string,
      hour: row.hour as string,
      p50: row.p50 as number,
      p95: row.p95 as number,
      p99: row.p99 as number,
      min: row.min as number,
      max: row.max as number,
      sampleCount: row.sample_count as number,
    })));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Start the hourly percentile aggregator.
 */
export function startPercentileAggregator(): void {
  if (_timer) return;

  // Backfill the last 24 hours on startup
  backfillPercentiles();

  // Run every hour
  _timer = setInterval(() => {
    aggregateLastHour();
  }, 60 * 60 * 1000);

  if (_timer.unref) _timer.unref();

  log.info('Percentile aggregator started');
}

export function stopPercentileAggregator(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log.info('Percentile aggregator stopped');
  }
}

function aggregateLastHour(): void {
  const db = getDb();
  const services = db.prepare('SELECT id FROM services').all() as { id: string }[];
  const lastHour = getHourString(-1);

  for (const svc of services) {
    aggregateHourlyPercentiles(svc.id, lastHour);
  }
}

function backfillPercentiles(): void {
  const db = getDb();
  const services = db.prepare('SELECT id FROM services').all() as { id: string }[];
  if (services.length === 0) return;

  let backfilledCount = 0;

  for (let h = -24; h < 0; h++) {
    const hour = getHourString(h);
    for (const svc of services) {
      const exists = db.prepare(
        'SELECT 1 FROM response_time_buckets WHERE service_id = ? AND hour = ?'
      ).get(svc.id, hour);

      if (!exists) {
        const result = aggregateHourlyPercentiles(svc.id, hour);
        if (result.ok && result.data) backfilledCount++;
      }
    }
  }

  if (backfilledCount > 0) {
    log.info({ backfilledCount }, 'Backfilled percentile buckets');
  }
}

function getHourString(offsetHours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + offsetHours, 0, 0, 0);
  return d.toISOString().slice(0, 13) + ':00:00';
}
