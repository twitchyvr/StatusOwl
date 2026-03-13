/**
 * Maintenance Window Tests
 *
 * Tests for CRUD operations and active-window queries on maintenance windows.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  createMaintenanceWindow,
  getMaintenanceWindow,
  listMaintenanceWindows,
  isInMaintenanceWindow,
  deleteMaintenanceWindow,
} from '../src/maintenance/index.js';
import { createService } from '../src/storage/index.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateMaintenanceWindow } from '../src/core/index.js';

describe('Maintenance Windows', () => {
  let db: ReturnType<typeof getDb>;
  let serviceId: string;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear tables in FK-safe order
    db.exec('DELETE FROM maintenance_windows');
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');

    // Create a service to attach maintenance windows to
    const result = createService({
      name: 'Maintenance Test Service',
      url: 'https://api.example.com/health',
    });
    expect(result.ok).toBe(true);
    serviceId = result.data.id;
  });

  // ── createMaintenanceWindow ──────────────────────────────────────────

  describe('createMaintenanceWindow', () => {
    it('should create a maintenance window with valid data', () => {
      const input: CreateMaintenanceWindow = {
        serviceId,
        title: 'Scheduled DB migration',
        startAt: '2025-06-01T02:00:00.000Z',
        endAt: '2025-06-01T04:00:00.000Z',
      };

      const result = createMaintenanceWindow(input);

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.serviceId).toBe(serviceId);
      expect(result.data.title).toBe('Scheduled DB migration');
      expect(result.data.startAt).toBe('2025-06-01T02:00:00.000Z');
      expect(result.data.endAt).toBe('2025-06-01T04:00:00.000Z');
      expect(result.data.createdAt).toBeDefined();
    });

    it('should return error when endAt equals startAt', () => {
      const input: CreateMaintenanceWindow = {
        serviceId,
        title: 'Zero-length window',
        startAt: '2025-06-01T02:00:00.000Z',
        endAt: '2025-06-01T02:00:00.000Z',
      };

      const result = createMaintenanceWindow(input);

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('endAt must be after startAt');
    });

    it('should return error when endAt is before startAt', () => {
      const input: CreateMaintenanceWindow = {
        serviceId,
        title: 'Backwards window',
        startAt: '2025-06-01T04:00:00.000Z',
        endAt: '2025-06-01T02:00:00.000Z',
      };

      const result = createMaintenanceWindow(input);

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('VALIDATION');
      expect(result.error.message).toContain('endAt must be after startAt');
    });
  });

  // ── getMaintenanceWindow ─────────────────────────────────────────────

  describe('getMaintenanceWindow', () => {
    it('should retrieve a maintenance window by id', () => {
      const createResult = createMaintenanceWindow({
        serviceId,
        title: 'Retrieve me',
        startAt: '2025-07-01T00:00:00.000Z',
        endAt: '2025-07-01T02:00:00.000Z',
      });
      expect(createResult.ok).toBe(true);
      const windowId = createResult.data.id;

      const result = getMaintenanceWindow(windowId);

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(windowId);
      expect(result.data.title).toBe('Retrieve me');
      expect(result.data.serviceId).toBe(serviceId);
    });

    it('should return NOT_FOUND for a non-existent id', () => {
      const result = getMaintenanceWindow('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── listMaintenanceWindows ───────────────────────────────────────────

  describe('listMaintenanceWindows', () => {
    it('should list all maintenance windows', () => {
      createMaintenanceWindow({
        serviceId,
        title: 'Window A',
        startAt: '2025-06-01T00:00:00.000Z',
        endAt: '2025-06-01T01:00:00.000Z',
      });
      createMaintenanceWindow({
        serviceId,
        title: 'Window B',
        startAt: '2025-06-02T00:00:00.000Z',
        endAt: '2025-06-02T01:00:00.000Z',
      });

      const result = listMaintenanceWindows();

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(2);
    });

    it('should filter by serviceId', () => {
      // Create a second service
      const svc2Result = createService({
        name: 'Other Service',
        url: 'https://other.example.com/health',
      });
      expect(svc2Result.ok).toBe(true);
      const otherServiceId = svc2Result.data.id;

      createMaintenanceWindow({
        serviceId,
        title: 'First service window',
        startAt: '2025-06-01T00:00:00.000Z',
        endAt: '2025-06-01T01:00:00.000Z',
      });
      createMaintenanceWindow({
        serviceId: otherServiceId,
        title: 'Other service window',
        startAt: '2025-06-01T00:00:00.000Z',
        endAt: '2025-06-01T01:00:00.000Z',
      });
      createMaintenanceWindow({
        serviceId,
        title: 'First service window 2',
        startAt: '2025-06-02T00:00:00.000Z',
        endAt: '2025-06-02T01:00:00.000Z',
      });

      const result = listMaintenanceWindows({ serviceId });

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data.every(w => w.serviceId === serviceId)).toBe(true);
    });

    it('should filter active windows (spanning now)', () => {
      const now = Date.now();
      const oneHourMs = 3600000;

      // Past window — already ended
      createMaintenanceWindow({
        serviceId,
        title: 'Past window',
        startAt: new Date(now - 2 * oneHourMs).toISOString(),
        endAt: new Date(now - 1 * oneHourMs).toISOString(),
      });

      // Active window — spans current time
      createMaintenanceWindow({
        serviceId,
        title: 'Active window',
        startAt: new Date(now - 1 * oneHourMs).toISOString(),
        endAt: new Date(now + 1 * oneHourMs).toISOString(),
      });

      // Future window — hasn't started yet
      createMaintenanceWindow({
        serviceId,
        title: 'Future window',
        startAt: new Date(now + 1 * oneHourMs).toISOString(),
        endAt: new Date(now + 2 * oneHourMs).toISOString(),
      });

      const result = listMaintenanceWindows({ active: true });

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].title).toBe('Active window');
    });

    it('should return empty array when no windows exist', () => {
      const result = listMaintenanceWindows();

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(0);
    });
  });

  // ── isInMaintenanceWindow ────────────────────────────────────────────

  describe('isInMaintenanceWindow', () => {
    it('should return true when service has an active maintenance window', () => {
      const now = Date.now();
      const oneHourMs = 3600000;

      createMaintenanceWindow({
        serviceId,
        title: 'Active maintenance',
        startAt: new Date(now - 1 * oneHourMs).toISOString(),
        endAt: new Date(now + 1 * oneHourMs).toISOString(),
      });

      const result = isInMaintenanceWindow(serviceId);

      expect(result).toBe(true);
    });

    it('should return false when service has only past maintenance windows', () => {
      const now = Date.now();
      const oneHourMs = 3600000;

      createMaintenanceWindow({
        serviceId,
        title: 'Past maintenance',
        startAt: new Date(now - 2 * oneHourMs).toISOString(),
        endAt: new Date(now - 1 * oneHourMs).toISOString(),
      });

      const result = isInMaintenanceWindow(serviceId);

      expect(result).toBe(false);
    });

    it('should return false when service has only future maintenance windows', () => {
      const now = Date.now();
      const oneHourMs = 3600000;

      createMaintenanceWindow({
        serviceId,
        title: 'Future maintenance',
        startAt: new Date(now + 1 * oneHourMs).toISOString(),
        endAt: new Date(now + 2 * oneHourMs).toISOString(),
      });

      const result = isInMaintenanceWindow(serviceId);

      expect(result).toBe(false);
    });

    it('should return false for a service with no maintenance windows', () => {
      const result = isInMaintenanceWindow(serviceId);

      expect(result).toBe(false);
    });

    it('should return false for a non-existent service id', () => {
      const result = isInMaintenanceWindow('00000000-0000-0000-0000-000000000000');

      expect(result).toBe(false);
    });
  });

  // ── deleteMaintenanceWindow ──────────────────────────────────────────

  describe('deleteMaintenanceWindow', () => {
    it('should delete an existing maintenance window', () => {
      const createResult = createMaintenanceWindow({
        serviceId,
        title: 'Delete me',
        startAt: '2025-08-01T00:00:00.000Z',
        endAt: '2025-08-01T02:00:00.000Z',
      });
      expect(createResult.ok).toBe(true);
      const windowId = createResult.data.id;

      const deleteResult = deleteMaintenanceWindow(windowId);

      expect(deleteResult.ok).toBe(true);

      // Verify it no longer exists
      const getResult = getMaintenanceWindow(windowId);
      expect(getResult.ok).toBe(false);
      expect(getResult.error.code).toBe('NOT_FOUND');
    });

    it('should return NOT_FOUND for a non-existent id', () => {
      const result = deleteMaintenanceWindow('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });
});
