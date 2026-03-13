/**
 * StatusOwl — SSL Check Repository
 *
 * Stores and queries SSL certificate check results.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result } from '../core/index.js';

const log = createChildLogger('SslRepo');

export interface SslCheckRecord {
  id: string;
  serviceId: string;
  valid: boolean;
  validFrom: string;
  validTo: string;
  issuer: string;
  subject: string;
  daysUntilExpiry: number;
  errorMessage: string | null;
  checkedAt: string;
}

export function recordSslCheck(
  serviceId: string,
  valid: boolean,
  validFrom: string,
  validTo: string,
  issuer: string,
  subject: string,
  daysUntilExpiry: number,
  errorMessage: string | null,
): Result<SslCheckRecord> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO ssl_checks (id, service_id, valid, valid_from, valid_to, issuer, subject, days_until_expiry, error_message, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, serviceId, valid ? 1 : 0, validFrom, validTo, issuer, subject, daysUntilExpiry, errorMessage, now);

    return ok({ id, serviceId, valid, validFrom, validTo, issuer, subject, daysUntilExpiry, errorMessage, checkedAt: now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ serviceId, error: msg }, 'Failed to record SSL check');
    return err('INSERT_FAILED', msg);
  }
}

export function getLatestSslCheck(serviceId: string): Result<SslCheckRecord | null> {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM ssl_checks
      WHERE service_id = ?
      ORDER BY checked_at DESC
      LIMIT 1
    `).get(serviceId) as Record<string, unknown> | undefined;

    if (!row) return ok(null);
    return ok(rowToSslCheck(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

export function getSslHistory(serviceId: string, limit = 30): Result<SslCheckRecord[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM ssl_checks
      WHERE service_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(serviceId, limit) as Record<string, unknown>[];

    return ok(rows.map(rowToSslCheck));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

function rowToSslCheck(row: Record<string, unknown>): SslCheckRecord {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    valid: Boolean(row.valid),
    validFrom: row.valid_from as string,
    validTo: row.valid_to as string,
    issuer: row.issuer as string,
    subject: row.subject as string,
    daysUntilExpiry: row.days_until_expiry as number,
    errorMessage: row.error_message as string | null,
    checkedAt: row.checked_at as string,
  };
}
