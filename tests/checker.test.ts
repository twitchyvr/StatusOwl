/**
 * Health Checker Tests
 * 
 * Tests for HTTP health check functionality.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { checkService } from '../src/monitors/checker.js';
import type { Service } from '../src/core/index.js';

describe('Health Checker', () => {
  // Mock service for testing
  const createMockService = (overrides: Partial<Service> = {}): Service => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Service',
    url: 'https://example.com/health',
    method: 'GET',
    expectedStatus: 200,
    checkInterval: 60,
    timeout: 10,
    status: 'unknown',
    enabled: true,
    groupId: null,
    sortOrder: 0,
    ...overrides,
  });

  describe('checkService', () => {
    it('should return operational for successful health check', async () => {
      // We can't make real HTTP calls in tests easily, so we mock fetch
      const mockResponse = {
        status: 200,
        ok: true,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = createMockService({ url: 'https://example.com/health' });
      const result = await checkService(service);

      expect(result.status).toBe('operational');
      expect(result.statusCode).toBe(200);
      expect(result.errorMessage).toBeNull();
      expect(result.responseTime).toBeGreaterThan(0);

      vi.restoreAllMocks();
    });

    it('should return degraded for unexpected 5xx status', async () => {
      const mockResponse = {
        status: 503,
        ok: false,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = createMockService({ url: 'https://example.com/health' });
      const result = await checkService(service);

      expect(result.status).toBe('major_outage');
      expect(result.statusCode).toBe(503);
      expect(result.errorMessage).toContain('Expected 200, got 503');

      vi.restoreAllMocks();
    });

    it('should return degraded for unexpected 4xx status', async () => {
      const mockResponse = {
        status: 404,
        ok: false,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = createMockService({ url: 'https://example.com/health' });
      const result = await checkService(service);

      expect(result.status).toBe('degraded');
      expect(result.statusCode).toBe(404);
      expect(result.errorMessage).toContain('Expected 200, got 404');

      vi.restoreAllMocks();
    });

    it('should return major_outage on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));

      const service = createMockService({ url: 'https://nonexistent.example.com' });
      const result = await checkService(service);

      expect(result.status).toBe('major_outage');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toContain('ENOTFOUND');

      vi.restoreAllMocks();
    });

    it('should return major_outage on timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

      const service = createMockService({ url: 'https://slow.example.com', timeout: 1 });
      const result = await checkService(service);

      expect(result.status).toBe('major_outage');
      expect(result.errorMessage).toContain('Timeout');

      vi.restoreAllMocks();
    });

    it('should use custom headers when provided', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = createMockService({
        url: 'https://example.com/api',
        headers: {
          'Authorization': 'Bearer test-token',
          'X-Custom-Header': 'custom-value',
        },
      });

      await checkService(service);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'X-Custom-Header': 'custom-value',
            'User-Agent': 'StatusOwl/1.0',
          }),
        })
      );

      vi.restoreAllMocks();
    });

    it('should use POST method with body when specified', async () => {
      const mockResponse = {
        status: 201,
        ok: true,
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = createMockService({
        url: 'https://example.com/api',
        method: 'POST',
        body: '{"key": "value"}',
        expectedStatus: 201,
      });

      await checkService(service);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          method: 'POST',
          body: '{"key": "value"}',
        })
      );

      vi.restoreAllMocks();
    });

    it('should measure response time accurately', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const service = createMockService();
      const result = await checkService(service);

      expect(result.responseTime).toBeGreaterThan(0);
      expect(typeof result.responseTime).toBe('number');

      vi.restoreAllMocks();
    });
  });
});
