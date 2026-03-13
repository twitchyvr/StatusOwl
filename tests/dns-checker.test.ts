/**
 * DNS Checker Tests
 *
 * Tests for DNS health check functionality.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as dns } from 'node:dns';
import { checkDns, parseDnsTarget } from '../src/monitors/dns-checker.js';

// ── parseDnsTarget ──

describe('parseDnsTarget', () => {
  it('parses dns://hostname format', () => {
    expect(parseDnsTarget('dns://example.com')).toBe('example.com');
  });

  it('parses dns://hostname with trailing path', () => {
    expect(parseDnsTarget('dns://example.com/some/path')).toBe('example.com');
  });

  it('parses https:// URL and extracts hostname', () => {
    expect(parseDnsTarget('https://www.example.com/path')).toBe('www.example.com');
  });

  it('parses http:// URL and extracts hostname', () => {
    expect(parseDnsTarget('http://api.example.com:8080/v1')).toBe('api.example.com');
  });

  it('returns plain hostname as-is', () => {
    expect(parseDnsTarget('example.com')).toBe('example.com');
  });

  it('returns null for empty string', () => {
    expect(parseDnsTarget('')).toBeNull();
  });

  it('returns null for empty dns:// scheme', () => {
    expect(parseDnsTarget('dns://')).toBeNull();
  });

  it('handles subdomain hostnames', () => {
    expect(parseDnsTarget('dns://sub.domain.example.com')).toBe('sub.domain.example.com');
  });
});

// ── checkDns ──

describe('checkDns', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns operational when DNS resolves successfully', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);

    const result = await checkDns('example.com');
    expect(result.status).toBe('operational');
    expect(result.resolvedAddresses).toEqual(['93.184.216.34']);
    expect(result.responseTime).toBeGreaterThan(0);
    expect(result.errorMessage).toBeNull();
  });

  it('returns multiple resolved addresses', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['1.2.3.4', '5.6.7.8']);

    const result = await checkDns('multi-a.example.com');
    expect(result.status).toBe('operational');
    expect(result.resolvedAddresses).toEqual(['1.2.3.4', '5.6.7.8']);
  });

  it('returns degraded when expected address is not in results', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);

    const result = await checkDns('example.com', '1.2.3.4');
    expect(result.status).toBe('degraded');
    expect(result.resolvedAddresses).toEqual(['93.184.216.34']);
    expect(result.errorMessage).toContain('Expected address 1.2.3.4');
    expect(result.errorMessage).toContain('93.184.216.34');
  });

  it('returns operational when expected address matches', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['10.0.0.1', '10.0.0.2']);

    const result = await checkDns('example.com', '10.0.0.2');
    expect(result.status).toBe('operational');
    expect(result.resolvedAddresses).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(result.errorMessage).toBeNull();
  });

  it('returns major_outage for NXDOMAIN (ENOTFOUND)', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue(
      Object.assign(new Error('queryA ENOTFOUND nonexistent.test'), { code: 'ENOTFOUND' })
    );

    const result = await checkDns('nonexistent.test');
    expect(result.status).toBe('major_outage');
    expect(result.resolvedAddresses).toEqual([]);
    expect(result.errorMessage).toContain('DNS resolution failed');
    expect(result.errorMessage).toContain('not found');
  });

  it('returns major_outage for ENODATA', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue(
      Object.assign(new Error('queryA ENODATA norecord.test'), { code: 'ENODATA' })
    );

    const result = await checkDns('norecord.test');
    expect(result.status).toBe('major_outage');
    expect(result.resolvedAddresses).toEqual([]);
    expect(result.errorMessage).toContain('DNS resolution failed');
  });

  it('returns major_outage for generic network errors', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue(new Error('DNS server unreachable'));

    const result = await checkDns('example.com');
    expect(result.status).toBe('major_outage');
    expect(result.resolvedAddresses).toEqual([]);
    expect(result.errorMessage).toBe('DNS server unreachable');
  });

  it('returns major_outage on timeout', async () => {
    // Simulate a DNS lookup that never resolves within the timeout
    vi.spyOn(dns, 'resolve4').mockImplementation(
      () => new Promise(() => { /* never resolves */ })
    );

    const result = await checkDns('slow.example.com', undefined, 100);
    expect(result.status).toBe('major_outage');
    expect(result.resolvedAddresses).toEqual([]);
    expect(result.errorMessage).toContain('DNS timeout after 100ms');
  });

  it('measures response time as a positive number', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['1.2.3.4']);

    const result = await checkDns('example.com');
    expect(typeof result.responseTime).toBe('number');
    expect(result.responseTime).toBeGreaterThan(0);
  });

  it('handles non-Error thrown values', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue('string error');

    const result = await checkDns('example.com');
    expect(result.status).toBe('major_outage');
    expect(result.errorMessage).toBe('string error');
  });
});
