/**
 * TCP Checker Tests
 *
 * Tests for TCP health check functionality.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as net from 'node:net';
import { checkTcp, parseTcpTarget } from '../src/monitors/tcp-checker.js';

// ── parseTcpTarget ──

describe('parseTcpTarget', () => {
  it('parses tcp://host:port format', () => {
    const result = parseTcpTarget('tcp://db.example.com:5432');
    expect(result).toEqual({ host: 'db.example.com', port: 5432 });
  });

  it('parses host:port format (no scheme)', () => {
    const result = parseTcpTarget('redis.local:6379');
    expect(result).toEqual({ host: 'redis.local', port: 6379 });
  });

  it('parses https:// URL and defaults to port 443', () => {
    const result = parseTcpTarget('https://example.com');
    expect(result).toEqual({ host: 'example.com', port: 443 });
  });

  it('parses http:// URL and defaults to port 80', () => {
    const result = parseTcpTarget('http://example.com');
    expect(result).toEqual({ host: 'example.com', port: 80 });
  });

  it('parses URL with explicit port', () => {
    const result = parseTcpTarget('https://example.com:8443');
    expect(result).toEqual({ host: 'example.com', port: 8443 });
  });

  it('returns null for tcp:// without port', () => {
    const result = parseTcpTarget('tcp://hostname-only');
    expect(result).toBeNull();
  });

  it('returns null for invalid port in tcp://', () => {
    const result = parseTcpTarget('tcp://host:notanumber');
    expect(result).toBeNull();
  });

  it('returns null for port out of range (0)', () => {
    const result = parseTcpTarget('tcp://host:0');
    expect(result).toBeNull();
  });

  it('returns null for port out of range (99999)', () => {
    const result = parseTcpTarget('tcp://host:99999');
    expect(result).toBeNull();
  });

  it('handles localhost:port', () => {
    const result = parseTcpTarget('localhost:3000');
    expect(result).toEqual({ host: 'localhost', port: 3000 });
  });
});

// ── checkTcp ──

describe('checkTcp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns operational when connection succeeds', async () => {
    // Spin up a local TCP server to connect to
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as net.AddressInfo;

    try {
      const result = await checkTcp('127.0.0.1', addr.port, 5000);
      expect(result.status).toBe('operational');
      expect(result.responseTime).toBeGreaterThan(0);
      expect(result.errorMessage).toBeNull();
    } finally {
      server.close();
    }
  });

  it('returns major_outage when connection is refused', async () => {
    // Use a port that is almost certainly not listening
    const result = await checkTcp('127.0.0.1', 59123, 3000);
    expect(result.status).toBe('major_outage');
    expect(result.responseTime).toBeGreaterThan(0);
    expect(result.errorMessage).not.toBeNull();
  });

  it('returns major_outage on timeout', async () => {
    // Create a server that listens but never calls accept (via backlog + pause)
    // to simulate a hanging connection. We intercept Socket to fire timeout
    // before the connect event.
    const origSocketConnect = net.Socket.prototype.connect;

    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      // Call the real connect to set things up, but immediately emit timeout
      // before the OS can complete the handshake
      const result = origSocketConnect.apply(this, args as Parameters<typeof origSocketConnect>);
      // Schedule the timeout emission on the next tick so the promise is waiting
      process.nextTick(() => {
        this.emit('timeout');
      });
      return result;
    });

    const result = await checkTcp('127.0.0.1', 59124, 50);
    expect(result.status).toBe('major_outage');
    expect(result.errorMessage).toContain('timeout');
  });

  it('measures response time as a positive number', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as net.AddressInfo;

    try {
      const result = await checkTcp('127.0.0.1', addr.port, 5000);
      expect(typeof result.responseTime).toBe('number');
      expect(result.responseTime).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });
});
