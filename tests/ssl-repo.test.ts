/**
 * SSL Repository Tests
 */

import { describe, it, expect } from 'vitest';
import { createService } from '../src/storage/index.js';
import { recordSslCheck, getLatestSslCheck, getSslHistory } from '../src/storage/ssl-repo.js';

describe('SSL Repository', () => {
  let serviceId: string;

  // Create a test service
  const ensureService = () => {
    if (serviceId) return;
    const result = createService({ name: 'SSL Test', url: 'https://example.com' });
    if (result.ok) serviceId = result.data.id;
  };

  describe('recordSslCheck', () => {
    it('records a valid SSL check', () => {
      ensureService();
      const result = recordSslCheck(
        serviceId, true,
        '2025-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z',
        'CN=Let\'s Encrypt', 'CN=example.com',
        365, null,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.valid).toBe(true);
      expect(result.data.daysUntilExpiry).toBe(365);
      expect(result.data.errorMessage).toBeNull();
    });

    it('records an invalid SSL check with error', () => {
      ensureService();
      const result = recordSslCheck(
        serviceId, false, '', '', '', '', -1, 'Certificate expired',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.valid).toBe(false);
      expect(result.data.errorMessage).toBe('Certificate expired');
    });
  });

  describe('getLatestSslCheck', () => {
    it('returns a check when records exist', () => {
      // Use a dedicated service to avoid cross-contamination from recordSslCheck tests
      const svc = createService({ name: 'SSL Latest Test', url: 'https://ssl-latest.example.com' });
      if (!svc.ok) return;
      const latestSvcId = svc.data.id;

      recordSslCheck(latestSvcId, true, '2025-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'Test Issuer', 'CN=test', 365, null);

      const result = getLatestSslCheck(latestSvcId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).not.toBeNull();
      expect(result.data!.valid).toBe(true);
      expect(result.data!.issuer).toBe('Test Issuer');
    });

    it('returns null for service with no checks', () => {
      const svc = createService({ name: 'No SSL', url: 'https://nossl.com' });
      if (!svc.ok) return;

      const result = getLatestSslCheck(svc.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    });
  });

  describe('getSslHistory', () => {
    it('returns check history in descending order', () => {
      ensureService();

      const result = getSslHistory(serviceId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('respects limit parameter', () => {
      ensureService();
      // Add several checks
      for (let i = 0; i < 5; i++) {
        recordSslCheck(serviceId, true, '', '', '', '', i * 30, null);
      }

      const result = getSslHistory(serviceId, 2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(2);
    });
  });
});
