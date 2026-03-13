/**
 * Monitoring Region Repository Tests
 *
 * Tests for CRUD operations on monitoring regions and regional latency breakdown.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/storage/database.js';
import { createRegion, listRegions, getRegion, deleteRegion, getRegionalLatency } from '../src/monitors/region-repo.js';
import { createService } from '../src/storage/service-repo.js';
import { recordCheck } from '../src/storage/check-repo.js';
import type { ServiceStatus } from '../src/core/index.js';

describe('Region Repository', () => {
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
    // Clean up regions (except default) and check results between tests
    db.exec("DELETE FROM monitoring_regions WHERE id != 'default'");
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM services');
  });

  describe('default region', () => {
    it('should have a default region after DB init', () => {
      const result = getRegion('default');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('default');
        expect(result.data.name).toBe('Default');
        expect(result.data.location).toBe('Local');
        expect(result.data.enabled).toBe(true);
      }
    });
  });

  describe('createRegion', () => {
    it('should create a new region', () => {
      const result = createRegion('us-east', 'US East', 'Virginia');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('us-east');
        expect(result.data.name).toBe('US East');
        expect(result.data.location).toBe('Virginia');
        expect(result.data.enabled).toBe(true);
      }
    });

    it('should reject duplicate id', () => {
      createRegion('eu-west', 'EU West', 'Ireland');
      const result = createRegion('eu-west', 'EU West Duplicate', 'London');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DUPLICATE');
      }
    });
  });

  describe('listRegions', () => {
    it('should return all regions including default', () => {
      createRegion('us-east', 'US East', 'Virginia');
      createRegion('eu-west', 'EU West', 'Ireland');

      const result = listRegions();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(3); // default + 2 new
        const ids = result.data.map(r => r.id);
        expect(ids).toContain('default');
        expect(ids).toContain('us-east');
        expect(ids).toContain('eu-west');
      }
    });
  });

  describe('getRegion', () => {
    it('should return a region by id', () => {
      createRegion('ap-south', 'Asia Pacific South', 'Mumbai');
      const result = getRegion('ap-south');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('ap-south');
        expect(result.data.name).toBe('Asia Pacific South');
        expect(result.data.location).toBe('Mumbai');
      }
    });

    it('should return NOT_FOUND for missing region', () => {
      const result = getRegion('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('deleteRegion', () => {
    it('should remove a region', () => {
      createRegion('temp-region', 'Temporary', 'Nowhere');
      const deleteResult = deleteRegion('temp-region');
      expect(deleteResult.ok).toBe(true);

      const getResult = getRegion('temp-region');
      expect(getResult.ok).toBe(false);
      if (!getResult.ok) {
        expect(getResult.error.code).toBe('NOT_FOUND');
      }
    });

    it('should reject deleting the default region', () => {
      const result = deleteRegion('default');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION');
      }
    });

    it('should return NOT_FOUND for missing region', () => {
      const result = deleteRegion('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('getRegionalLatency', () => {
    it('should return empty array with no checks', () => {
      const serviceResult = createService({
        name: 'Latency Test Service',
        url: 'https://latency.example.com',
      });
      const serviceId = serviceResult.ok ? serviceResult.data.id : '';

      const result = getRegionalLatency(serviceId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });

    it('should return correct breakdown with check data', () => {
      // Create a second region for the test
      createRegion('us-west', 'US West', 'Oregon');

      const serviceResult = createService({
        name: 'Multi-Region Service',
        url: 'https://multi.example.com',
      });
      const serviceId = serviceResult.ok ? serviceResult.data.id : '';

      // Record checks from different regions
      recordCheck(serviceId, 'operational' as ServiceStatus, 100, 200, null, 'default');
      recordCheck(serviceId, 'operational' as ServiceStatus, 120, 200, null, 'default');
      recordCheck(serviceId, 'operational' as ServiceStatus, 200, 200, null, 'us-west');
      recordCheck(serviceId, 'operational' as ServiceStatus, 220, 200, null, 'us-west');

      const result = getRegionalLatency(serviceId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(2);

        // Results should be ordered by avg response time ascending
        const defaultRegion = result.data.find(r => r.regionId === 'default');
        const usWestRegion = result.data.find(r => r.regionId === 'us-west');

        expect(defaultRegion).toBeDefined();
        expect(defaultRegion!.regionName).toBe('Default');
        expect(defaultRegion!.avgResponseTime).toBe(110);
        expect(defaultRegion!.checkCount).toBe(2);

        expect(usWestRegion).toBeDefined();
        expect(usWestRegion!.regionName).toBe('US West');
        expect(usWestRegion!.avgResponseTime).toBe(210);
        expect(usWestRegion!.checkCount).toBe(2);
      }
    });
  });
});
