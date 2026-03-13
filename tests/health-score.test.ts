/**
 * Health Score & SLA Tests
 *
 * Tests for health score calculation, SLA compliance, and SLA target CRUD.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createService } from '../src/storage/service-repo.js';
import { recordCheck } from '../src/storage/check-repo.js';
import { createIncident } from '../src/incidents/incident-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import {
  createSlaTarget,
  getSlaTarget,
  getSlaTargetByService,
  updateSlaTarget,
  deleteSlaTarget,
  listSlaTargets,
  calculateHealthScore,
  calculateSlaCompliance,
  normalizeUptimeScore,
  normalizeResponseTimeScore,
  normalizeErrorRateScore,
  normalizeIncidentScore,
} from '../src/sla/index.js';
import type { IncidentSeverity } from '../src/core/index.js';

describe('Health Score & SLA', () => {
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
    // Clean all tables used in tests
    db.exec('DELETE FROM sla_targets');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM services');

    // Create a test service
    const serviceResult = createService({
      name: 'Health Score Test Service',
      url: 'https://health.example.com/api',
    });
    testServiceId = serviceResult.data.id;
  });

  // ── Normalization Functions ──

  describe('normalizeUptimeScore', () => {
    it('should return 100 for perfect uptime', () => {
      expect(normalizeUptimeScore(100)).toBe(100);
    });

    it('should return 0 for 90% uptime', () => {
      expect(normalizeUptimeScore(90)).toBe(0);
    });

    it('should return 0 for uptime below 90%', () => {
      expect(normalizeUptimeScore(85)).toBe(0);
      expect(normalizeUptimeScore(50)).toBe(0);
      expect(normalizeUptimeScore(0)).toBe(0);
    });

    it('should scale linearly between 90% and 100%', () => {
      expect(normalizeUptimeScore(95)).toBe(50);
      expect(normalizeUptimeScore(99)).toBeCloseTo(90, 0);
    });
  });

  describe('normalizeResponseTimeScore', () => {
    it('should return 100 for response times at or below 100ms', () => {
      expect(normalizeResponseTimeScore(100)).toBe(100);
      expect(normalizeResponseTimeScore(50)).toBe(100);
      expect(normalizeResponseTimeScore(0)).toBe(100);
    });

    it('should return 0 for response times at or above 5000ms', () => {
      expect(normalizeResponseTimeScore(5000)).toBe(0);
      expect(normalizeResponseTimeScore(10000)).toBe(0);
    });

    it('should scale linearly between 100ms and 5000ms', () => {
      // Midpoint: (5000 - 2550) / 4900 * 100 = 50
      expect(normalizeResponseTimeScore(2550)).toBeCloseTo(50, 0);
    });
  });

  describe('normalizeErrorRateScore', () => {
    it('should return 100 when no checks exist', () => {
      expect(normalizeErrorRateScore(0, 0)).toBe(100);
    });

    it('should return 100 when all checks are successful', () => {
      expect(normalizeErrorRateScore(100, 100)).toBe(100);
    });

    it('should return 0 when all checks fail', () => {
      expect(normalizeErrorRateScore(100, 0)).toBe(0);
    });

    it('should scale with error percentage', () => {
      // 50% success = 50% error = score 50
      expect(normalizeErrorRateScore(100, 50)).toBe(50);
    });
  });

  describe('normalizeIncidentScore', () => {
    it('should return 100 for zero incidents', () => {
      expect(normalizeIncidentScore(0)).toBe(100);
    });

    it('should decrease by 20 per incident', () => {
      expect(normalizeIncidentScore(1)).toBe(80);
      expect(normalizeIncidentScore(2)).toBe(60);
      expect(normalizeIncidentScore(3)).toBe(40);
    });

    it('should floor at 0 for 5 or more incidents', () => {
      expect(normalizeIncidentScore(5)).toBe(0);
      expect(normalizeIncidentScore(10)).toBe(0);
    });
  });

  // ── SLA Target CRUD ──

  describe('SLA Target CRUD', () => {
    it('should create an SLA target', () => {
      const result = createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.serviceId).toBe(testServiceId);
      expect(result.data.uptimeTarget).toBe(99.9);
      expect(result.data.responseTimeTarget).toBe(500);
      expect(result.data.evaluationPeriod).toBe('monthly');
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
    });

    it('should reject duplicate SLA target for same service', () => {
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });

      const result = createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.5,
        responseTimeTarget: 1000,
        evaluationPeriod: 'quarterly',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('DUPLICATE');
    });

    it('should get an SLA target by ID', () => {
      const created = createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });
      if (!created.ok) throw new Error('Failed to create SLA target');

      const result = getSlaTarget(created.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.uptimeTarget).toBe(99.9);
    });

    it('should return NOT_FOUND for non-existent SLA target', () => {
      const result = getSlaTarget('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should get SLA target by service ID', () => {
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.95,
        responseTimeTarget: 300,
        evaluationPeriod: 'quarterly',
      });

      const result = getSlaTargetByService(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).not.toBeNull();
      expect(result.data!.serviceId).toBe(testServiceId);
      expect(result.data!.uptimeTarget).toBe(99.95);
    });

    it('should return null for service with no SLA target', () => {
      const result = getSlaTargetByService(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    });

    it('should update an SLA target', () => {
      const created = createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });
      if (!created.ok) throw new Error('Failed to create SLA target');

      const result = updateSlaTarget(created.data.id, {
        uptimeTarget: 99.95,
        responseTimeTarget: 300,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.uptimeTarget).toBe(99.95);
      expect(result.data.responseTimeTarget).toBe(300);
      expect(result.data.evaluationPeriod).toBe('monthly'); // unchanged
    });

    it('should return NOT_FOUND when updating non-existent target', () => {
      const result = updateSlaTarget('00000000-0000-0000-0000-000000000000', {
        uptimeTarget: 99.5,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should delete an SLA target', () => {
      const created = createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });
      if (!created.ok) throw new Error('Failed to create SLA target');

      const deleteResult = deleteSlaTarget(created.data.id);
      expect(deleteResult.ok).toBe(true);

      const getResult = getSlaTarget(created.data.id);
      expect(getResult.ok).toBe(false);
    });

    it('should return NOT_FOUND when deleting non-existent target', () => {
      const result = deleteSlaTarget('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should list all SLA targets', () => {
      // Create a second service
      const svc2 = createService({
        name: 'SLA List Test Service 2',
        url: 'https://sla2.example.com',
      });

      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });

      createSlaTarget({
        serviceId: svc2.data.id,
        uptimeTarget: 99.5,
        responseTimeTarget: 1000,
        evaluationPeriod: 'quarterly',
      });

      const result = listSlaTargets();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);
    });
  });

  // ── Health Score Calculation ──

  describe('calculateHealthScore', () => {
    it('should return a perfect score when service has all successful checks and no incidents', () => {
      // Insert operational check results with fast response times
      for (let i = 0; i < 10; i++) {
        recordCheck(testServiceId, 'operational', 50, 200, null);
      }

      const result = calculateHealthScore(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.score).toBe(100);
      expect(result.data.breakdown.uptimeScore).toBe(100);
      expect(result.data.breakdown.responseTimeScore).toBe(100);
      expect(result.data.breakdown.errorRateScore).toBe(100);
      expect(result.data.breakdown.incidentScore).toBe(100);
    });

    it('should return a zero score when service is completely down', () => {
      // Insert failing check results with slow response times
      for (let i = 0; i < 10; i++) {
        recordCheck(testServiceId, 'major_outage', 6000, 500, 'Connection timeout');
      }

      // Add many incidents
      for (let i = 0; i < 6; i++) {
        createIncident(testServiceId, `Outage ${i}`, 'critical' as IncidentSeverity);
      }

      const result = calculateHealthScore(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.score).toBe(0);
      expect(result.data.breakdown.uptimeScore).toBe(0);
      expect(result.data.breakdown.responseTimeScore).toBe(0);
      expect(result.data.breakdown.errorRateScore).toBe(0);
      expect(result.data.breakdown.incidentScore).toBe(0);
    });

    it('should return correct weights in the response', () => {
      recordCheck(testServiceId, 'operational', 50, 200, null);

      const result = calculateHealthScore(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.weights.uptime).toBe(0.40);
      expect(result.data.weights.responseTime).toBe(0.25);
      expect(result.data.weights.errorRate).toBe(0.20);
      expect(result.data.weights.incidents).toBe(0.15);
    });

    it('should handle a service with no check data gracefully', () => {
      const result = calculateHealthScore(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // No data: uptime defaults to 100%, response time to 0 (fast), no errors, no incidents
      expect(result.data.score).toBe(100);
    });

    it('should produce a partial score for degraded service', () => {
      // 8 operational, 2 failing = 80% uptime
      for (let i = 0; i < 8; i++) {
        recordCheck(testServiceId, 'operational', 200, 200, null);
      }
      for (let i = 0; i < 2; i++) {
        recordCheck(testServiceId, 'major_outage', 3000, 500, 'Error');
      }

      // 1 incident
      createIncident(testServiceId, 'Partial Outage', 'major' as IncidentSeverity);

      const result = calculateHealthScore(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Score should be between 0 and 100 (not perfect, not zero)
      expect(result.data.score).toBeGreaterThan(0);
      expect(result.data.score).toBeLessThan(100);
      // Uptime should be penalized (80% < 90% threshold, so uptimeScore = 0)
      expect(result.data.breakdown.uptimeScore).toBe(0);
      // Incident score should be 80 (1 incident = 100 - 20)
      expect(result.data.breakdown.incidentScore).toBe(80);
    });

    it('should clamp score between 0 and 100', () => {
      // Even with all metrics at extremes, score should stay in bounds
      for (let i = 0; i < 20; i++) {
        recordCheck(testServiceId, 'major_outage', 10000, 500, 'Timeout');
      }
      for (let i = 0; i < 10; i++) {
        createIncident(testServiceId, `Outage ${i}`, 'critical' as IncidentSeverity);
      }

      const result = calculateHealthScore(testServiceId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.score).toBeGreaterThanOrEqual(0);
      expect(result.data.score).toBeLessThanOrEqual(100);
    });
  });

  // ── SLA Compliance ──

  describe('calculateSlaCompliance', () => {
    it('should return NOT_FOUND when no SLA target is configured', () => {
      const result = calculateSlaCompliance(testServiceId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should report compliant when uptime and response time meet targets', () => {
      // Set SLA target
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.0,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });

      // Insert all successful checks with fast response
      for (let i = 0; i < 100; i++) {
        recordCheck(testServiceId, 'operational', 100, 200, null);
      }

      const result = calculateSlaCompliance(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.compliant).toBe(true);
      expect(result.data.uptimeActual).toBe(100);
      expect(result.data.responseTimeActual).toBeLessThanOrEqual(500);
      expect(result.data.period).toBe('monthly');
      expect(result.data.target.uptimeTarget).toBe(99.0);
    });

    it('should report non-compliant when uptime is below target', () => {
      // Set strict SLA target
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });

      // Insert 90% uptime (below 99.9% target)
      for (let i = 0; i < 90; i++) {
        recordCheck(testServiceId, 'operational', 100, 200, null);
      }
      for (let i = 0; i < 10; i++) {
        recordCheck(testServiceId, 'major_outage', 100, 500, 'Error');
      }

      const result = calculateSlaCompliance(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.compliant).toBe(false);
      expect(result.data.uptimeActual).toBe(90);
    });

    it('should report non-compliant when response time exceeds target', () => {
      // Set SLA target with tight response time
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 90.0,
        responseTimeTarget: 100,
        evaluationPeriod: 'monthly',
      });

      // All checks successful but slow
      for (let i = 0; i < 100; i++) {
        recordCheck(testServiceId, 'operational', 500, 200, null);
      }

      const result = calculateSlaCompliance(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.compliant).toBe(false);
      expect(result.data.responseTimeActual).toBeGreaterThan(100);
    });

    it('should use quarterly evaluation period when configured', () => {
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.0,
        responseTimeTarget: 500,
        evaluationPeriod: 'quarterly',
      });

      for (let i = 0; i < 10; i++) {
        recordCheck(testServiceId, 'operational', 100, 200, null);
      }

      const result = calculateSlaCompliance(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.period).toBe('quarterly');
    });

    it('should include the target object in the response', () => {
      createSlaTarget({
        serviceId: testServiceId,
        uptimeTarget: 99.9,
        responseTimeTarget: 500,
        evaluationPeriod: 'monthly',
      });

      recordCheck(testServiceId, 'operational', 100, 200, null);

      const result = calculateSlaCompliance(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.target).toBeDefined();
      expect(result.data.target.serviceId).toBe(testServiceId);
      expect(result.data.target.uptimeTarget).toBe(99.9);
      expect(result.data.target.responseTimeTarget).toBe(500);
    });
  });
});
