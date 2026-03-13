/**
 * Percentile Aggregator Tests
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { computePercentile, aggregateHourlyPercentiles, getPercentiles } from '../src/monitors/percentile-aggregator.js';
import { createService } from '../src/storage/index.js';
import { getDb } from '../src/storage/database.js';

describe('Percentile Aggregator', () => {
  describe('computePercentile', () => {
    it('returns 0 for empty array', () => {
      expect(computePercentile([], 50)).toBe(0);
    });

    it('returns the single value for single-element array', () => {
      expect(computePercentile([100], 50)).toBe(100);
      expect(computePercentile([100], 99)).toBe(100);
    });

    it('computes p50 correctly', () => {
      const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const p50 = computePercentile(sorted, 50);
      expect(p50).toBe(50);
    });

    it('computes p95 correctly', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = computePercentile(sorted, 95);
      expect(p95).toBe(95);
    });

    it('computes p99 correctly', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      const p99 = computePercentile(sorted, 99);
      expect(p99).toBe(99);
    });

    it('handles small arrays', () => {
      const sorted = [10, 50, 200];
      expect(computePercentile(sorted, 50)).toBe(50);
      expect(computePercentile(sorted, 95)).toBe(200);
    });
  });

  describe('aggregateHourlyPercentiles', () => {
    it('returns null when no checks exist for the hour', () => {
      const svc = createService({ name: 'Perc Test Empty', url: 'https://perc-empty.example.com' });
      if (!svc.ok) return;

      const result = aggregateHourlyPercentiles(svc.data.id, '2020-01-01T00:00:00');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    });

    it('aggregates percentiles from check results', () => {
      const svc = createService({ name: 'Perc Test', url: 'https://perc.example.com' });
      if (!svc.ok) return;
      const id = svc.data.id;

      const db = getDb();
      const hour = '2025-06-15T10:00:00';

      // Insert 10 checks with response times 10-100ms
      for (let i = 1; i <= 10; i++) {
        db.prepare(`
          INSERT INTO check_results (id, service_id, status, response_time, status_code, error_message, checked_at)
          VALUES (?, ?, 'operational', ?, 200, NULL, ?)
        `).run(randomUUID(), id, i * 10, `2025-06-15T10:${String(i).padStart(2, '0')}:00.000Z`);
      }

      const result = aggregateHourlyPercentiles(id, hour);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;

      expect(result.data.sampleCount).toBe(10);
      expect(result.data.min).toBe(10);
      expect(result.data.max).toBe(100);
      expect(result.data.p50).toBe(50);
    });
  });

  describe('getPercentiles', () => {
    it('returns empty array for service with no buckets', () => {
      const svc = createService({ name: 'No Buckets', url: 'https://nobuckets.example.com' });
      if (!svc.ok) return;

      const result = getPercentiles(svc.data.id, 24);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    });
  });
});
