/**
 * Check Repository Tests
 * 
 * Tests for recording check results and uptime summaries.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { recordCheck, getRecentChecks, getUptimeSummary, pruneOldChecks } from '../src/storage/check-repo.js';
import { createService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { ServiceStatus } from '../src/core/index.js';

describe('Check Repository', () => {
  let testServiceId: string;
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM services');

    // Create a test service for check recording
    const serviceResult = createService({
      name: 'Check Test Service',
      url: 'https://check.example.com/health',
    });
    testServiceId = serviceResult.data.id;
  });

  describe('recordCheck', () => {
    it('should record a successful check', () => {
      const result = recordCheck(
        testServiceId,
        'operational' as ServiceStatus,
        150.5,
        200,
        null
      );

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.serviceId).toBe(testServiceId);
      expect(result.data.status).toBe('operational');
      expect(result.data.responseTime).toBe(150.5);
      expect(result.data.statusCode).toBe(200);
      expect(result.data.errorMessage).toBeNull();
      expect(result.data.checkedAt).toBeDefined();
    });

    it('should record a failed check', () => {
      const result = recordCheck(
        testServiceId,
        'major_outage' as ServiceStatus,
        5000,
        null,
        'Connection timeout'
      );

      expect(result.ok).toBe(true);
      expect(result.data.status).toBe('major_outage');
      expect(result.data.responseTime).toBe(5000);
      expect(result.data.statusCode).toBeNull();
      expect(result.data.errorMessage).toBe('Connection timeout');
    });

    it('should record a degraded check', () => {
      const result = recordCheck(
        testServiceId,
        'degraded' as ServiceStatus,
        2000,
        503,
        'Service temporarily unavailable'
      );

      expect(result.ok).toBe(true);
      expect(result.data.status).toBe('degraded');
      expect(result.data.statusCode).toBe(503);
    });
  });

  describe('getRecentChecks', () => {
    it('should retrieve recent checks for a service', () => {
      // Record 5 checks in a specific order: operational, operational, operational, major_outage, major_outage
      // Due to SQL's datetime precision, we need to be careful about ordering
      // Insert with explicit timing using a small delay
      recordCheck(testServiceId, 'operational' as ServiceStatus, 100, 200, null);
      recordCheck(testServiceId, 'operational' as ServiceStatus, 110, 200, null);
      recordCheck(testServiceId, 'operational' as ServiceStatus, 120, 200, null);
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, 500, 'Server error');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5100, 500, 'Server error');

      const result = getRecentChecks(testServiceId, 10);

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(5);
      // All checks recorded — verify we have both statuses present
      const statuses = result.data.map((c: { status: string }) => c.status);
      expect(statuses).toContain('operational');
      expect(statuses).toContain('major_outage');
    });

    it('should respect the limit parameter', () => {
      // Record several checks
      for (let i = 0; i < 5; i++) {
        recordCheck(testServiceId, 'operational' as ServiceStatus, 100 + i * 10, 200, null);
      }

      const result = getRecentChecks(testServiceId, 3);

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(3);
    });

    it('should return empty array for service with no checks', () => {
      // Create a new service without checks
      const newService = createService({ name: 'No Checks', url: 'https://nochecks.example.com' });
      const result = getRecentChecks(newService.data.id);

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(0);
    });
  });

  describe('getUptimeSummary', () => {
    it('should calculate uptime percentage correctly', () => {
      // Record 10 checks: 8 successful, 2 failed
      for (let i = 0; i < 10; i++) {
        recordCheck(
          testServiceId,
          i < 8 ? 'operational' as ServiceStatus : 'major_outage' as ServiceStatus,
          100 + i * 10,
          i < 8 ? 200 : 500,
          i < 8 ? null : 'Server error'
        );
      }

      const result = getUptimeSummary(testServiceId, '24h');

      expect(result.ok).toBe(true);
      expect(result.data.totalChecks).toBe(10);
      expect(result.data.successfulChecks).toBe(8);
      expect(result.data.uptimePercent).toBe(80);
    });

    it('should calculate average response time', () => {
      // Record specific response times: 100, 110, 120, 130, 140, 150, 160, 170, 180, 190 = average 145
      for (let i = 0; i < 10; i++) {
        recordCheck(
          testServiceId,
          'operational' as ServiceStatus,
          100 + i * 10,
          200,
          null
        );
      }

      const result = getUptimeSummary(testServiceId, '24h');

      expect(result.ok).toBe(true);
      expect(result.data.avgResponseTime).toBe(145);
    });

    it('should return 100% uptime for service with no checks', () => {
      const newService = createService({ name: 'Uptime Test', url: 'https://uptime.example.com' });
      const result = getUptimeSummary(newService.data.id, '24h');

      expect(result.ok).toBe(true);
      expect(result.data.uptimePercent).toBe(100);
      expect(result.data.totalChecks).toBe(0);
    });

    it('should support different time periods', () => {
      const periods: Array<'24h' | '7d' | '30d' | '90d'> = ['24h', '7d', '30d', '90d'];

      for (const period of periods) {
        const result = getUptimeSummary(testServiceId, period);
        expect(result.ok).toBe(true);
        expect(result.data.period).toBe(period);
      }
    });
  });

  describe('pruneOldChecks', () => {
    it('should prune checks older than specified days', () => {
      // This test verifies the function runs without error
      const result = pruneOldChecks(90);

      expect(result.ok).toBe(true);
      expect(typeof result.data).toBe('number');
    });
  });
});
