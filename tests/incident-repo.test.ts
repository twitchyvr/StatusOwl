/**
 * Incident Repository Tests
 * 
 * Tests for incident CRUD operations and resolution.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createIncident, resolveIncident, getOpenIncidents, getIncidentById, getIncidentsByService, updateIncidentStatus } from '../src/incidents/incident-repo.js';
import { createService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { IncidentSeverity, IncidentStatus } from '../src/core/index.js';

describe('Incident Repository', () => {
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
      name: 'Incident Test Service',
      url: 'https://incident.example.com/health',
    });
    testServiceId = serviceResult.data.id;
  });

  describe('createIncident', () => {
    it('should create an incident', () => {
      const result = createIncident(
        testServiceId,
        'Test Incident',
        'minor' as IncidentSeverity
      );

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.title).toBe('Test Incident');
      expect(result.data.severity).toBe('minor');
      expect(result.data.status).toBe('investigating');
      expect(result.data.serviceIds).toContain(testServiceId);
      expect(result.data.message).toBe('');
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.resolvedAt).toBeNull();
    });

    it('should create an incident with different severity levels', () => {
      const severities: IncidentSeverity[] = ['minor', 'major', 'critical'];

      for (const severity of severities) {
        const result = createIncident(
          testServiceId,
          `Incident ${severity}`,
          severity
        );

        expect(result.ok).toBe(true);
        expect(result.data.severity).toBe(severity);
      }
    });

    it('should link incident to the service', () => {
      const result = createIncident(
        testServiceId,
        'Linked Incident',
        'major' as IncidentSeverity
      );

      expect(result.ok).toBe(true);
      expect(result.data.serviceIds).toHaveLength(1);
      expect(result.data.serviceIds[0]).toBe(testServiceId);
    });
  });

  describe('resolveIncident', () => {
    it('should resolve an incident', () => {
      // First create an incident
      const createResult = createIncident(
        testServiceId,
        'Resolving Test',
        'minor' as IncidentSeverity
      );
      const incidentId = createResult.data.id;

      // Then resolve it
      const result = resolveIncident(db, incidentId, 'Issue has been fixed');

      expect(result.ok).toBe(true);
      expect(result.data.status).toBe('resolved');
      expect(result.data.resolvedAt).toBeDefined();
    });

    it('should add timeline entry when resolving', () => {
      const createResult = createIncident(
        testServiceId,
        'Timeline Test',
        'minor' as IncidentSeverity
      );
      const incidentId = createResult.data.id;

      const resolveResult = resolveIncident(db, incidentId, 'Fixed the issue');
      
      expect(resolveResult.ok).toBe(true);
      // The incident should be resolved
      expect(resolveResult.data.status).toBe('resolved');
    });
  });

  describe('getOpenIncidents', () => {
    it('should return all open incidents', () => {
      // Create multiple incidents, some resolved
      createIncident(testServiceId, 'Open 1', 'minor' as IncidentSeverity);
      createIncident(testServiceId, 'Open 2', 'major' as IncidentSeverity);

      // Create and resolve one
      const resolved = createIncident(testServiceId, 'To Be Resolved', 'critical' as IncidentSeverity);
      resolveIncident(db, resolved.data.id, 'Resolved');

      const result = getOpenIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data.every(i => i.status !== 'resolved')).toBe(true);
    });

    it('should return empty array when no open incidents', () => {
      const result = getOpenIncidents();

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(0);
    });
  });

  describe('getIncidentById', () => {
    it('should retrieve an incident by ID', () => {
      const createResult = createIncident(
        testServiceId,
        'Get By ID Test',
        'major' as IncidentSeverity
      );
      const incidentId = createResult.data.id;

      const result = getIncidentById(incidentId);

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(incidentId);
      expect(result.data.title).toBe('Get By ID Test');
    });

    it('should return NOT_FOUND for non-existent incident', () => {
      const result = getIncidentById('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('getIncidentsByService', () => {
    it('should return all incidents for a service', () => {
      // Create multiple incidents for the same service
      createIncident(testServiceId, 'Service Incident 1', 'minor' as IncidentSeverity);
      createIncident(testServiceId, 'Service Incident 2', 'major' as IncidentSeverity);

      // Create a different service with its own incident
      const otherService = createService({ name: 'Other', url: 'https://other.com' });
      createIncident(otherService.data.id, 'Other Incident', 'critical' as IncidentSeverity);

      const result = getIncidentsByService(testServiceId);

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data.every(i => i.serviceIds.includes(testServiceId))).toBe(true);
    });
  });

  describe('updateIncidentStatus', () => {
    it('should update incident status', () => {
      const createResult = createIncident(
        testServiceId,
        'Status Update Test',
        'minor' as IncidentSeverity
      );
      const incidentId = createResult.data.id;

      const result = updateIncidentStatus(
        incidentId,
        'identified' as IncidentStatus,
        'Root cause identified'
      );

      expect(result.ok).toBe(true);
      expect(result.data.status).toBe('identified');
    });

    it('should transition through all status values', () => {
      const createResult = createIncident(
        testServiceId,
        'Status Flow Test',
        'minor' as IncidentSeverity
      );
      const incidentId = createResult.data.id;

      // investigating -> identified -> monitoring -> resolved
      const statuses: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];

      for (const status of statuses) {
        const result = updateIncidentStatus(incidentId, status, `Status changed to ${status}`);
        expect(result.ok).toBe(true);
        expect(result.data.status).toBe(status);
      }
    });
  });
});
