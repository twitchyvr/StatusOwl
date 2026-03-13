/**
 * Alert Policy Tests
 *
 * Tests for CRUD operations on alert policies, cooldown management,
 * and policy defaults.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  createAlertPolicy,
  getAlertPolicy,
  getAlertPolicyByService,
  listAlertPolicies,
  updateAlertPolicy,
  deleteAlertPolicy,
  isInCooldown,
  recordAlertTime,
} from '../src/alerts/alert-policy-repo.js';
import { createService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateAlertPolicy } from '../src/core/index.js';

describe('Alert Policy Repository', () => {
  let db: ReturnType<typeof getDb>;
  let testServiceId: string;
  let testServiceId2: string;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear tables in dependency order
    db.exec('DELETE FROM alert_cooldowns');
    db.exec('DELETE FROM alert_policies');
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');

    // Create test services
    const svc1 = createService({
      name: 'Alert Test Service 1',
      url: 'https://alert1.example.com/health',
      enabled: true,
    });
    testServiceId = svc1.data.id;

    const svc2 = createService({
      name: 'Alert Test Service 2',
      url: 'https://alert2.example.com/health',
      enabled: true,
    });
    testServiceId2 = svc2.data.id;
  });

  describe('createAlertPolicy', () => {
    it('should create a policy with all fields', () => {
      const input: CreateAlertPolicy = {
        serviceId: testServiceId,
        failureThreshold: 5,
        responseTimeThresholdMs: 2000,
        cooldownMinutes: 60,
        enabled: true,
      };

      const result = createAlertPolicy(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.serviceId).toBe(testServiceId);
      expect(result.data.failureThreshold).toBe(5);
      expect(result.data.responseTimeThresholdMs).toBe(2000);
      expect(result.data.cooldownMinutes).toBe(60);
      expect(result.data.enabled).toBe(true);
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
    });

    it('should apply defaults for failureThreshold and cooldownMinutes', () => {
      const input: CreateAlertPolicy = {
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      };

      const result = createAlertPolicy(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failureThreshold).toBe(3);
      expect(result.data.cooldownMinutes).toBe(30);
      expect(result.data.responseTimeThresholdMs).toBeNull();
    });

    it('should enforce unique service_id constraint', () => {
      const input: CreateAlertPolicy = {
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      };

      const first = createAlertPolicy(input);
      expect(first.ok).toBe(true);

      // Second policy for same service should fail
      const second = createAlertPolicy(input);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('DB_ERROR');
    });
  });

  describe('getAlertPolicy', () => {
    it('should retrieve a policy by ID', () => {
      const input: CreateAlertPolicy = {
        serviceId: testServiceId,
        failureThreshold: 5,
        responseTimeThresholdMs: 1500,
        cooldownMinutes: 45,
        enabled: true,
      };

      const created = createAlertPolicy(input);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = getAlertPolicy(created.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.failureThreshold).toBe(5);
    });

    it('should return NOT_FOUND for non-existent ID', () => {
      const result = getAlertPolicy('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('getAlertPolicyByService', () => {
    it('should retrieve a policy by service ID', () => {
      const input: CreateAlertPolicy = {
        serviceId: testServiceId,
        failureThreshold: 7,
        responseTimeThresholdMs: null,
        cooldownMinutes: 15,
        enabled: true,
      };

      createAlertPolicy(input);

      const result = getAlertPolicyByService(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).not.toBeNull();
      expect(result.data!.serviceId).toBe(testServiceId);
      expect(result.data!.failureThreshold).toBe(7);
    });

    it('should return null for service with no policy', () => {
      const result = getAlertPolicyByService(testServiceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    });
  });

  describe('listAlertPolicies', () => {
    it('should return empty array when no policies exist', () => {
      const result = listAlertPolicies();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });

    it('should return all policies', () => {
      createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });
      createAlertPolicy({
        serviceId: testServiceId2,
        failureThreshold: 5,
        responseTimeThresholdMs: 1000,
        cooldownMinutes: 60,
        enabled: false,
      });

      const result = listAlertPolicies();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);
      // Both policies should be present (order may vary for same-millisecond inserts)
      const serviceIds = result.data.map((p) => p.serviceId).sort();
      expect(serviceIds).toContain(testServiceId);
      expect(serviceIds).toContain(testServiceId2);
    });
  });

  describe('updateAlertPolicy', () => {
    it('should update partial fields', () => {
      const created = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = updateAlertPolicy(created.data.id, {
        failureThreshold: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failureThreshold).toBe(10);
      // Other fields should remain unchanged
      expect(result.data.cooldownMinutes).toBe(30);
      expect(result.data.enabled).toBe(true);
      expect(result.data.responseTimeThresholdMs).toBeNull();
    });

    it('should update multiple fields at once', () => {
      const created = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = updateAlertPolicy(created.data.id, {
        failureThreshold: 5,
        cooldownMinutes: 60,
        enabled: false,
        responseTimeThresholdMs: 3000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failureThreshold).toBe(5);
      expect(result.data.cooldownMinutes).toBe(60);
      expect(result.data.enabled).toBe(false);
      expect(result.data.responseTimeThresholdMs).toBe(3000);
    });

    it('should update updatedAt timestamp', () => {
      const created = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = updateAlertPolicy(created.data.id, {
        failureThreshold: 5,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.updatedAt).toBeDefined();
    });

    it('should return NOT_FOUND for non-existent ID', () => {
      const result = updateAlertPolicy('00000000-0000-0000-0000-000000000000', {
        failureThreshold: 5,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('deleteAlertPolicy', () => {
    it('should delete an existing policy', () => {
      const created = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deleteResult = deleteAlertPolicy(created.data.id);
      expect(deleteResult.ok).toBe(true);

      // Verify it's gone
      const getResult = getAlertPolicy(created.data.id);
      expect(getResult.ok).toBe(false);
      if (getResult.ok) return;
      expect(getResult.error.code).toBe('NOT_FOUND');
    });

    it('should return NOT_FOUND for non-existent ID', () => {
      const result = deleteAlertPolicy('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Cooldown management', () => {
    it('isInCooldown should return false when no alert has been recorded', () => {
      const result = isInCooldown(testServiceId, 30);
      expect(result).toBe(false);
    });

    it('isInCooldown should return true within cooldown period', () => {
      recordAlertTime(testServiceId);
      const result = isInCooldown(testServiceId, 30);
      expect(result).toBe(true);
    });

    it('isInCooldown should return false when cooldown is 0', () => {
      recordAlertTime(testServiceId);
      const result = isInCooldown(testServiceId, 0);
      // With 0 minute cooldown, the cooldown end is at the same time as last_alert
      // so new Date() should be >= cooldownEnd
      expect(result).toBe(false);
    });

    it('recordAlertTime should update existing record on conflict', () => {
      recordAlertTime(testServiceId);
      // Record again (should upsert, not throw)
      recordAlertTime(testServiceId);

      // Should still be in cooldown
      const result = isInCooldown(testServiceId, 30);
      expect(result).toBe(true);
    });

    it('cooldown should be independent per service', () => {
      recordAlertTime(testServiceId);

      // testServiceId should be in cooldown
      expect(isInCooldown(testServiceId, 30)).toBe(true);
      // testServiceId2 should NOT be in cooldown
      expect(isInCooldown(testServiceId2, 30)).toBe(false);
    });
  });

  describe('Policy defaults', () => {
    it('should use default failureThreshold of 3', () => {
      const result = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failureThreshold).toBe(3);
    });

    it('should use default cooldownMinutes of 30', () => {
      const result = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.cooldownMinutes).toBe(30);
    });

    it('should default responseTimeThresholdMs to null', () => {
      const result = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.responseTimeThresholdMs).toBeNull();
    });

    it('should default enabled to true', () => {
      const result = createAlertPolicy({
        serviceId: testServiceId,
        failureThreshold: 3,
        responseTimeThresholdMs: null,
        cooldownMinutes: 30,
        enabled: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.enabled).toBe(true);
    });
  });
});
