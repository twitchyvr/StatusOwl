/**
 * Service Repository Tests
 * 
 * Tests for CRUD operations on monitored services.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createService, getService, listServices, updateService, updateServiceStatus, deleteService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateService } from '../src/core/index.js';

describe('Service Repository', () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    // Ensure we're using in-memory database
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear ALL tables before each test to ensure isolation
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');
    db.exec('DELETE FROM service_groups');
    db.exec('DELETE FROM webhooks');
    db.exec('DELETE FROM uptime_daily');
  });

  describe('createService', () => {
    it('should create a service with minimal input', () => {
      const input: CreateService = {
        name: 'Test API',
        url: 'https://api.example.com/health',
      };

      const result = createService(input);

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe('Test API');
      expect(result.data.url).toBe('https://api.example.com/health');
      expect(result.data.method).toBe('GET');
      expect(result.data.expectedStatus).toBe(200);
      expect(result.data.status).toBe('unknown');
      expect(result.data.enabled).toBeTruthy();
      expect(result.data.checkInterval).toBe(60);
      expect(result.data.timeout).toBe(10);
    });

    it('should create a service with full input', () => {
      const input: CreateService = {
        name: 'Full Test API',
        url: 'https://api.example.com/v2/health',
        method: 'POST',
        expectedStatus: 201,
        checkInterval: 30,
        timeout: 5,
        headers: { 'Authorization': 'Bearer token123' },
        body: '{"key": "value"}',
        enabled: true,
        groupId: null,
        sortOrder: 1,
      };

      const result = createService(input);

      expect(result.ok).toBe(true);
      expect(result.data.method).toBe('POST');
      expect(result.data.expectedStatus).toBe(201);
      expect(result.data.checkInterval).toBe(30);
      expect(result.data.timeout).toBe(5);
      expect(result.data.headers).toEqual({ 'Authorization': 'Bearer token123' });
      expect(result.data.body).toBe('{"key": "value"}');
      expect(result.data.sortOrder).toBe(1);
    });

    it('should create a service with custom method', () => {
      const input: CreateService = {
        name: 'POST API',
        url: 'https://api.example.com/submit',
        method: 'POST',
        body: '{"action": "submit"}',
      };

      const result = createService(input);

      expect(result.ok).toBe(true);
      expect(result.data.method).toBe('POST');
      expect(result.data.body).toBe('{"action": "submit"}');
    });
  });

  describe('getService', () => {
    it('should retrieve a service by ID', () => {
      // First create a service
      const createInput: CreateService = {
        name: 'Get Test Service',
        url: 'https://get.example.com/health',
      };
      const createResult = createService(createInput);
      const serviceId = createResult.data.id;

      // Then get it
      const result = getService(serviceId);

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(serviceId);
      expect(result.data.name).toBe('Get Test Service');
    });

    it('should return NOT_FOUND for non-existent service', () => {
      const result = getService('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('listServices', () => {
    it('should list all services', () => {
      // Create multiple services for testing
      createService({ name: 'Service A', url: 'https://a.example.com', enabled: true });
      createService({ name: 'Service B', url: 'https://b.example.com', enabled: false });
      createService({ name: 'Service C', url: 'https://c.example.com', enabled: true });

      const result = listServices();

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(3);
    });

    it('should filter by enabled status', () => {
      createService({ name: 'Service A', url: 'https://a.example.com', enabled: true });
      createService({ name: 'Service B', url: 'https://b.example.com', enabled: false });
      createService({ name: 'Service C', url: 'https://c.example.com', enabled: true });

      const result = listServices({ enabled: true });

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data.every(s => s.enabled)).toBe(true);
    });
  });

  describe('updateService', () => {
    it('should update service fields', () => {
      // Create a service
      const createResult = createService({ name: 'Original Name', url: 'https://original.example.com' });
      const serviceId = createResult.data.id;

      // Update it
      const result = updateService(serviceId, {
        name: 'Updated Name',
        checkInterval: 120,
      });

      expect(result.ok).toBe(true);
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.checkInterval).toBe(120);
      // Original values should be preserved
      expect(result.data.url).toBe('https://original.example.com');
    });

    it('should return NOT_FOUND for non-existent service', () => {
      const result = updateService('00000000-0000-0000-0000-000000000000', { name: 'New Name' });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('updateServiceStatus', () => {
    it('should update service status', () => {
      const createResult = createService({ name: 'Status Test', url: 'https://status.example.com' });
      const serviceId = createResult.data.id;

      const result = updateServiceStatus(serviceId, 'operational');

      expect(result.ok).toBe(true);

      // Verify the status was actually updated
      const getResult = getService(serviceId);
      expect(getResult.data.status).toBe('operational');
    });
  });

  describe('deleteService', () => {
    it('should delete a service', () => {
      const createResult = createService({ name: 'Delete Test', url: 'https://delete.example.com' });
      const serviceId = createResult.data.id;

      const deleteResult = deleteService(serviceId);
      expect(deleteResult.ok).toBe(true);

      // Verify it's gone
      const getResult = getService(serviceId);
      expect(getResult.ok).toBe(false);
    });

    it('should return NOT_FOUND for non-existent service', () => {
      const result = deleteService('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });
});
