/**
 * StatusOwl — DNS Health Checker
 *
 * Performs DNS resolution checks to verify domain availability.
 */

import { promises as dns } from 'node:dns';
import { createChildLogger } from '../core/index.js';
import type { ServiceStatus } from '../core/index.js';

const log = createChildLogger('DNSChecker');

export interface DnsCheckOutcome {
  status: ServiceStatus;
  responseTime: number;
  resolvedAddresses: string[];
  errorMessage: string | null;
}

/**
 * Check DNS resolution for a hostname.
 * Optionally verify that the resolved addresses include an expected value.
 *
 * @param hostname - The domain to resolve
 * @param expectedAddress - Optional expected IP address to verify
 * @param timeoutMs - Resolution timeout in milliseconds (default: 10000)
 */
export async function checkDns(
  hostname: string,
  expectedAddress?: string,
  timeoutMs = 10_000
): Promise<DnsCheckOutcome> {
  const start = performance.now();

  try {
    // Race DNS lookup against timeout
    const addresses = await Promise.race([
      dns.resolve4(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`DNS timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    const responseTime = performance.now() - start;

    // If expected address is set, verify it's in the results
    if (expectedAddress && !addresses.includes(expectedAddress)) {
      return {
        status: 'degraded',
        responseTime,
        resolvedAddresses: addresses,
        errorMessage: `Expected address ${expectedAddress} not found in resolved addresses: ${addresses.join(', ')}`,
      };
    }

    log.debug({ hostname, addresses, responseTime: Math.round(responseTime) }, 'DNS check completed');

    return {
      status: 'operational',
      responseTime,
      resolvedAddresses: addresses,
      errorMessage: null,
    };
  } catch (e) {
    const responseTime = performance.now() - start;
    const error = e instanceof Error ? e : new Error(String(e));

    log.warn({ hostname, error: error.message }, 'DNS check failed');

    // Determine if it's a "not found" (NXDOMAIN) vs network error
    const isNxdomain = error.message.includes('ENOTFOUND') || error.message.includes('ENODATA');

    return {
      status: 'major_outage',
      responseTime,
      resolvedAddresses: [],
      errorMessage: isNxdomain
        ? `DNS resolution failed: ${hostname} not found`
        : error.message,
    };
  }
}

/**
 * Extract hostname from a URL for DNS checking.
 * Supports formats: "dns://hostname", or standard URL.
 */
export function parseDnsTarget(url: string): string | null {
  try {
    // Handle dns:// scheme
    if (url.startsWith('dns://')) {
      const hostname = url.slice(6).replace(/\/.*$/, '');
      return hostname || null;
    }

    // Handle standard URL
    if (url.includes('://')) {
      const parsed = new URL(url);
      return parsed.hostname || null;
    }

    // Plain hostname
    return url || null;
  } catch {
    return null;
  }
}
