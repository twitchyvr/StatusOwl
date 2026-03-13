/**
 * StatusOwl — SSL/TLS Certificate Checker
 *
 * Monitors SSL certificate expiry for services with sslMonitoring enabled.
 * Uses Node's tls module to connect and extract certificate details.
 */

import * as tls from 'node:tls';
import { createChildLogger } from '../core/index.js';

const log = createChildLogger('SslChecker');

export interface SslCheckResult {
  valid: boolean;
  validFrom: string;
  validTo: string;
  issuer: string;
  subject: string;
  daysUntilExpiry: number;
  errorMessage: string | null;
}

/**
 * Check the SSL certificate for a given URL.
 * Extracts certificate details and calculates days until expiry.
 */
export async function checkSslCertificate(url: string, timeoutMs = 10000): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol !== 'https:') {
        resolve({
          valid: false,
          validFrom: '',
          validTo: '',
          issuer: '',
          subject: '',
          daysUntilExpiry: -1,
          errorMessage: 'URL is not HTTPS',
        });
        return;
      }

      const host = parsedUrl.hostname;
      const port = parseInt(parsedUrl.port) || 443;

      const socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false },
        () => {
          const cert = socket.getPeerCertificate();

          if (!cert || !cert.valid_from || !cert.valid_to) {
            socket.destroy();
            resolve({
              valid: false,
              validFrom: '',
              validTo: '',
              issuer: '',
              subject: '',
              daysUntilExpiry: -1,
              errorMessage: 'No certificate found',
            });
            return;
          }

          const validFrom = new Date(cert.valid_from).toISOString();
          const validTo = new Date(cert.valid_to).toISOString();
          const now = Date.now();
          const expiryMs = new Date(cert.valid_to).getTime() - now;
          const daysUntilExpiry = Math.floor(expiryMs / (1000 * 60 * 60 * 24));

          const issuer = cert.issuer
            ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(', ')
            : '';
          const subject = cert.subject
            ? Object.entries(cert.subject).map(([k, v]) => `${k}=${v}`).join(', ')
            : '';

          socket.destroy();

          resolve({
            valid: socket.authorized,
            validFrom,
            validTo,
            issuer,
            subject,
            daysUntilExpiry,
            errorMessage: socket.authorized ? null : socket.authorizationError?.toString() || null,
          });
        },
      );

      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        resolve({
          valid: false,
          validFrom: '',
          validTo: '',
          issuer: '',
          subject: '',
          daysUntilExpiry: -1,
          errorMessage: `SSL check timed out after ${timeoutMs}ms`,
        });
      });

      socket.on('error', (err) => {
        socket.destroy();
        log.warn({ host, error: err.message }, 'SSL check error');
        resolve({
          valid: false,
          validFrom: '',
          validTo: '',
          issuer: '',
          subject: '',
          daysUntilExpiry: -1,
          errorMessage: err.message,
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resolve({
        valid: false,
        validFrom: '',
        validTo: '',
        issuer: '',
        subject: '',
        daysUntilExpiry: -1,
        errorMessage: msg,
      });
    }
  });
}

/**
 * Get the SSL alert level based on days until expiry.
 */
export function getSslAlertLevel(daysUntilExpiry: number): 'ok' | 'warning' | 'critical' | 'expired' {
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 7) return 'critical';
  if (daysUntilExpiry <= 14) return 'critical';
  if (daysUntilExpiry <= 30) return 'warning';
  return 'ok';
}
