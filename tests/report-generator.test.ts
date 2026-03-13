/**
 * Report Generator Tests
 *
 * Tests for generating, retrieving, and listing uptime reports.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { generateReport, getReport, listReports } from '../src/reports/report-generator.js';
import { createService } from '../src/storage/service-repo.js';
import { recordCheck } from '../src/storage/check-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { ServiceStatus } from '../src/core/index.js';

describe('Report Generator', () => {
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
    db.exec('DELETE FROM uptime_reports');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM services');
  });

  describe('generateReport("daily")', () => {
    it('should create a report with correct period and dates', () => {
      const result = generateReport('daily');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.id).toBeDefined();
      expect(result.data.period).toBe('daily');
      expect(result.data.startDate).toBeDefined();
      expect(result.data.endDate).toBeDefined();
      expect(result.data.generatedAt).toBeDefined();

      // Verify the date range is 1 day
      const start = new Date(result.data.startDate);
      const end = new Date(result.data.endDate);
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(1);
    });
  });

  describe('generateReport("weekly")', () => {
    it('should create a report with 7-day range', () => {
      const result = generateReport('weekly');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.period).toBe('weekly');

      // Verify the date range is 7 days
      const start = new Date(result.data.startDate);
      const end = new Date(result.data.endDate);
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });
  });

  describe('generateReport includes service stats', () => {
    it('should include per-service statistics in data', () => {
      // Create two services
      const svc1 = createService({ name: 'API Server', url: 'https://api.example.com/health' });
      const svc2 = createService({ name: 'Web App', url: 'https://app.example.com/health' });

      expect(svc1.ok).toBe(true);
      expect(svc2.ok).toBe(true);
      if (!svc1.ok || !svc2.ok) return;

      // Record checks for both services
      for (let i = 0; i < 5; i++) {
        recordCheck(svc1.data.id, 'operational' as ServiceStatus, 100 + i * 10, 200, null);
        recordCheck(svc2.data.id, 'operational' as ServiceStatus, 200 + i * 10, 200, null);
      }
      // Record one failure for svc2
      recordCheck(svc2.data.id, 'major_outage' as ServiceStatus, 5000, 500, 'Server error');

      const result = generateReport('daily');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = result.data.data;
      expect(data.serviceCount).toBe(2);
      expect(data.services).toHaveLength(2);

      // Find each service in the report
      const svc1Stats = data.services.find((s: { serviceId: string }) => s.serviceId === svc1.data.id);
      const svc2Stats = data.services.find((s: { serviceId: string }) => s.serviceId === svc2.data.id);

      expect(svc1Stats).toBeDefined();
      expect(svc1Stats.serviceName).toBe('API Server');
      expect(svc1Stats.totalChecks).toBe(5);
      expect(svc1Stats.successfulChecks).toBe(5);
      expect(svc1Stats.uptimePercent).toBe(100);

      expect(svc2Stats).toBeDefined();
      expect(svc2Stats.serviceName).toBe('Web App');
      expect(svc2Stats.totalChecks).toBe(6);
      expect(svc2Stats.successfulChecks).toBe(5);
    });
  });

  describe('generateReport handles no services', () => {
    it('should produce a valid report with no services gracefully', () => {
      const result = generateReport('daily');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = result.data.data;
      expect(data.serviceCount).toBe(0);
      expect(data.services).toHaveLength(0);
      expect(data.overallUptime).toBe(100);
    });
  });

  describe('getReport', () => {
    it('should retrieve a report by ID', () => {
      const genResult = generateReport('daily');
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) return;

      const result = getReport(genResult.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.id).toBe(genResult.data.id);
      expect(result.data.period).toBe('daily');
      expect(result.data.startDate).toBe(genResult.data.startDate);
      expect(result.data.endDate).toBe(genResult.data.endDate);
      expect(result.data.generatedAt).toBeDefined();
    });

    it('should return NOT_FOUND for missing ID', () => {
      const result = getReport('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('listReports', () => {
    it('should return all reports', () => {
      generateReport('daily');
      generateReport('weekly');
      generateReport('daily');

      const result = listReports();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data).toHaveLength(3);
    });

    it('should filter by period', () => {
      generateReport('daily');
      generateReport('weekly');
      generateReport('daily');

      const dailyResult = listReports({ period: 'daily' });
      expect(dailyResult.ok).toBe(true);
      if (!dailyResult.ok) return;
      expect(dailyResult.data).toHaveLength(2);
      expect(dailyResult.data.every(r => r.period === 'daily')).toBe(true);

      const weeklyResult = listReports({ period: 'weekly' });
      expect(weeklyResult.ok).toBe(true);
      if (!weeklyResult.ok) return;
      expect(weeklyResult.data).toHaveLength(1);
      expect(weeklyResult.data[0].period).toBe('weekly');
    });

    it('should respect limit', () => {
      generateReport('daily');
      generateReport('daily');
      generateReport('daily');
      generateReport('daily');
      generateReport('daily');

      const result = listReports({ limit: 3 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data).toHaveLength(3);
    });
  });

  describe('Report data JSON', () => {
    it('should produce well-formed JSON data in stored reports', () => {
      // Create a service with checks so the report has meaningful data
      const svc = createService({ name: 'JSON Test', url: 'https://json.example.com' });
      expect(svc.ok).toBe(true);
      if (!svc.ok) return;

      recordCheck(svc.data.id, 'operational' as ServiceStatus, 120, 200, null);
      recordCheck(svc.data.id, 'operational' as ServiceStatus, 130, 200, null);

      const genResult = generateReport('daily');
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) return;

      // Retrieve from DB and verify JSON is well-formed
      const fetched = getReport(genResult.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;

      const data = fetched.data.data;
      expect(typeof data).toBe('object');
      expect(typeof data.overallUptime).toBe('number');
      expect(typeof data.serviceCount).toBe('number');
      expect(Array.isArray(data.services)).toBe(true);

      // Verify the service entry structure
      expect(data.services).toHaveLength(1);
      const svcData = data.services[0];
      expect(typeof svcData.serviceId).toBe('string');
      expect(typeof svcData.serviceName).toBe('string');
      expect(typeof svcData.uptimePercent).toBe('number');
      expect(typeof svcData.totalChecks).toBe('number');
      expect(typeof svcData.successfulChecks).toBe('number');
      expect(typeof svcData.avgResponseTime).toBe('number');
    });
  });
});
