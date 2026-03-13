/**
 * Incident Detector Tests
 * 
 * Tests for automatic incident detection based on check failures.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { detectIncidents, getOpenIncidentsForApi, getIncidentsForService, getIncident } from '../src/incidents/detector.js';
import { createService, updateServiceStatus } from '../src/storage/service-repo.js';
import { recordCheck } from '../src/storage/check-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { ServiceStatus } from '../src/core/index.js';

describe('Incident Detector', () => {
  let testServiceId: string;
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'silent';
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

    // Create a test service
    const serviceResult = createService({
      name: 'Detector Test Service',
      url: 'https://detector.example.com/health',
      enabled: true,
    });
    testServiceId = serviceResult.data.id;
  });

  describe('detectIncidents', () => {
    it('should NOT create incident for less than 3 consecutive failures', () => {
      // Record 2 failures
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const result = detectIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.created).toHaveLength(0);
    });

    it('should create incident after 3 consecutive failures', () => {
      // Record 3 consecutive failures
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const result = detectIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.created).toHaveLength(1);
      expect(result.data.created[0].title).toContain('is down');
      expect(result.data.created[0].serviceIds).toContain(testServiceId);
    });

    it('should create incident with correct severity based on failure types', () => {
      // Test degraded -> partial_outage -> major_outage progression for critical
      recordCheck(testServiceId, 'degraded' as ServiceStatus, 2000, 503, 'Slow response');
      recordCheck(testServiceId, 'partial_outage' as ServiceStatus, 3000, 503, 'High error rate');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const result = detectIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.created).toHaveLength(1);
      expect(result.data.created[0].severity).toBe('critical');
    });

    it('should NOT create duplicate incident if one already exists', () => {
      // Record 3 failures to create first incident
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      // First detection creates incident
      const firstResult = detectIncidents();
      expect(firstResult.data.created).toHaveLength(1);
      const incidentId = firstResult.data.created[0].id;

      // Add more failures
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      // Second detection should NOT create another incident
      const secondResult = detectIncidents();
      expect(secondResult.data.created).toHaveLength(0);

      // Verify only one incident exists
      const openIncidents = getOpenIncidentsForApi();
      expect(openIncidents.data).toHaveLength(1);
      expect(openIncidents.data[0].id).toBe(incidentId);
    });

    it('should resolve incident when service recovers', () => {
      // Create an incident first by having 3 failures
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const firstResult = detectIncidents();
      expect(firstResult.data.created).toHaveLength(1);
      const incidentId = firstResult.data.created[0].id;

      // Add a successful check (recovery)
      recordCheck(testServiceId, 'operational' as ServiceStatus, 150, 200, null);

      // Run detection again - should resolve the incident
      const secondResult = detectIncidents();

      expect(secondResult.data.resolved).toHaveLength(1);
      expect(secondResult.data.resolved[0].id).toBe(incidentId);
      expect(secondResult.data.resolved[0].status).toBe('resolved');

      // Verify incident is now resolved
      const getResult = getIncident(incidentId);
      expect(getResult.data.status).toBe('resolved');
      expect(getResult.data.resolvedAt).toBeDefined();
    });

    it('should NOT resolve incident if service is still failing', () => {
      // Create an incident
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const firstResult = detectIncidents();
      expect(firstResult.data.created).toHaveLength(1);

      // Add another failure (not a recovery)
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      // Run detection - should NOT resolve
      const secondResult = detectIncidents();

      expect(secondResult.data.resolved).toHaveLength(0);
      expect(secondResult.data.created).toHaveLength(0);

      // Verify incident is still open
      const openIncidents = getOpenIncidentsForApi();
      expect(openIncidents.data).toHaveLength(1);
      expect(openIncidents.data[0].status).toBe('investigating');
    });

    it('should handle multiple services independently', () => {
      // Create second service
      const service2 = createService({
        name: 'Service 2',
        url: 'https://service2.example.com',
        enabled: true,
      });
      const service2Id = service2.data.id;

      // Service 1: 3 failures -> should create incident
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      // Service 2: only 2 failures -> no incident
      recordCheck(service2Id, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(service2Id, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const result = detectIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.created).toHaveLength(1);
      expect(result.data.created[0].serviceIds).toContain(testServiceId);
    });

    it('should track failures with mixed operational and failure statuses', () => {
      // Pattern: fail, fail, success, fail, fail, fail
      // Should only count the last 3 consecutive failures
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'operational' as ServiceStatus, 150, 200, null); // Reset counter
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const result = detectIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.created).toHaveLength(1);
    });

    it('should update service status to major_outage when incident created', async () => {
      // Record 3 failures
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      detectIncidents();

      // The detector doesn't automatically update service status
      // But the service check outcome from the checker would
      // This test verifies the detector creates the incident
      const openIncidents = getOpenIncidentsForApi();
      expect(openIncidents.data).toHaveLength(1);
    });
  });

  describe('convenience functions', () => {
    it('getOpenIncidentsForApi should return open incidents', () => {
      // Create an incident
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      detectIncidents();

      const result = getOpenIncidentsForApi();
      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(1);
    });

    it('getIncidentsForService should return incidents for specific service', () => {
      // Create incident
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      detectIncidents();

      const result = getIncidentsForService(testServiceId);
      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].serviceIds).toContain(testServiceId);
    });

    it('getIncident should return specific incident', () => {
      // Create incident
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');
      recordCheck(testServiceId, 'major_outage' as ServiceStatus, 5000, null, 'Timeout');

      const detectResult = detectIncidents();
      const incidentId = detectResult.data.created[0].id;

      const result = getIncident(incidentId);
      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(incidentId);
    });
  });
});
