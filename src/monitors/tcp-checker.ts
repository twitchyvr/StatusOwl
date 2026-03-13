/**
 * StatusOwl — TCP Health Checker
 *
 * Performs TCP connection checks to verify port availability.
 */

import * as net from 'node:net';
import { createChildLogger } from '../core/index.js';
import type { ServiceStatus } from '../core/index.js';

const log = createChildLogger('TCPChecker');

export interface TcpCheckOutcome {
  status: ServiceStatus;
  responseTime: number;
  errorMessage: string | null;
}

/**
 * Check if a TCP port is open and accepting connections.
 *
 * @param host - The hostname or IP address
 * @param port - The port number
 * @param timeoutMs - Connection timeout in milliseconds (default: 10000)
 */
export function checkTcp(host: string, port: number, timeoutMs = 10_000): Promise<TcpCheckOutcome> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const responseTime = performance.now() - start;
      socket.destroy();
      resolve({
        status: 'operational',
        responseTime,
        errorMessage: null,
      });
    });

    socket.on('timeout', () => {
      const responseTime = performance.now() - start;
      socket.destroy();
      resolve({
        status: 'major_outage',
        responseTime,
        errorMessage: `TCP connection timeout after ${timeoutMs}ms`,
      });
    });

    socket.on('error', (err) => {
      const responseTime = performance.now() - start;
      socket.destroy();

      const isRefused = err.message.includes('ECONNREFUSED');
      log.warn({ host, port, error: err.message }, 'TCP check failed');

      resolve({
        status: 'major_outage',
        responseTime,
        errorMessage: isRefused
          ? `Connection refused on ${host}:${port}`
          : err.message,
      });
    });

    socket.connect(port, host);
  });
}

/**
 * Parse a URL into host and port for TCP checking.
 * Supports formats: "tcp://host:port", "host:port", or plain URL (extracts host, uses URL port or 443/80).
 */
export function parseTcpTarget(url: string): { host: string; port: number } | null {
  try {
    // Handle tcp:// scheme
    if (url.startsWith('tcp://')) {
      const parts = url.slice(6).split(':');
      if (parts.length === 2) {
        const port = parseInt(parts[1], 10);
        if (isNaN(port) || port < 1 || port > 65535) return null;
        return { host: parts[0], port };
      }
      return null;
    }

    // Handle host:port (no scheme)
    if (!url.includes('://') && url.includes(':')) {
      const parts = url.split(':');
      const port = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(port) && port >= 1 && port <= 65535) {
        return { host: parts.slice(0, -1).join(':'), port };
      }
    }

    // Handle standard URL
    const parsed = new URL(url);
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:' ? 443 : 80;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}
