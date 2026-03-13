/**
 * StatusOwl — Webhook Delivery
 *
 * Manages webhook delivery lifecycle with exponential backoff retry
 * and dead letter queue for permanently failed deliveries.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result } from '../core/index.js';

const log = createChildLogger('WebhookDelivery');

// ── Types ────────────────────────────────────────────────────────

export type DeliveryStatus = 'pending' | 'success' | 'failed' | 'dead';

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface WebhookDeadLetter {
  id: string;
  deliveryId: string;
  webhookId: string;
  eventType: string;
  payload: string;
  errorMessage: string | null;
  createdAt: string;
}

// ── Backoff Configuration ────────────────────────────────────────

/** Base delay in milliseconds for exponential backoff */
const BASE_DELAY_MS = 1000;
/** Maximum number of retry attempts before moving to dead letter queue */
const MAX_ATTEMPTS = 5;
/** Jitter range: +/- 25% */
const JITTER_FACTOR = 0.25;

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Format a Date as a SQLite-compatible datetime string (YYYY-MM-DD HH:MM:SS).
 * This ensures consistent string comparison in SQLite queries.
 */
function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ── Backoff Calculation ──────────────────────────────────────────

/**
 * Calculate the next retry time using exponential backoff with jitter.
 *
 * Delays: 1s, 2s, 4s, 8s, 16s (base * 2^attempt) with +/-25% jitter.
 *
 * @param attempt - The current attempt number (0-based)
 * @returns ISO datetime string for the next retry
 */
export function calculateNextRetry(attempt: number): string {
  const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = baseDelay * JITTER_FACTOR * (2 * Math.random() - 1);
  const delayMs = Math.max(0, baseDelay + jitter);
  return toSqliteDatetime(new Date(Date.now() + delayMs));
}

// ── Delivery Operations ──────────────────────────────────────────

/**
 * Record a new pending webhook delivery.
 */
export function recordDelivery(
  webhookId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Result<WebhookDelivery> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = toSqliteDatetime(new Date());
    const payloadJson = JSON.stringify(payload);

    db.prepare(`
      INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, attempts, max_attempts, created_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
    `).run(id, webhookId, eventType, payloadJson, MAX_ATTEMPTS, now);

    log.info({ id, webhookId, eventType }, 'Delivery recorded');
    return getDeliveryById(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, webhookId, eventType }, 'Failed to record delivery');
    return err('CREATE_FAILED', msg);
  }
}

/**
 * Mark a delivery as successfully completed.
 */
export function markDeliverySuccess(
  id: string,
  responseStatus: number,
  responseBody: string,
): Result<WebhookDelivery> {
  try {
    const db = getDb();
    const now = toSqliteDatetime(new Date());

    const result = db.prepare(`
      UPDATE webhook_deliveries
      SET status = 'success',
          attempts = attempts + 1,
          last_attempt_at = ?,
          next_retry_at = NULL,
          response_status = ?,
          response_body = ?
      WHERE id = ?
    `).run(now, responseStatus, responseBody, id);

    if (result.changes === 0) {
      return err('NOT_FOUND', `Delivery ${id} not found`);
    }

    log.info({ id, responseStatus }, 'Delivery marked as success');
    return getDeliveryById(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, id }, 'Failed to mark delivery success');
    return err('UPDATE_FAILED', msg);
  }
}

/**
 * Mark a delivery as failed. Increments the attempt counter and calculates
 * the next retry time using exponential backoff. If max attempts are reached,
 * automatically moves the delivery to the dead letter queue.
 */
export function markDeliveryFailed(
  id: string,
  errorMessage: string,
  responseStatus?: number,
): Result<WebhookDelivery> {
  try {
    const db = getDb();
    const now = toSqliteDatetime(new Date());

    // Get current delivery state
    const existing = getDeliveryById(id);
    if (!existing.ok) {
      return existing;
    }

    const delivery = existing.data;
    const newAttempts = delivery.attempts + 1;

    // Check if we've exhausted retries
    if (newAttempts >= delivery.maxAttempts) {
      // Update to failed state first
      db.prepare(`
        UPDATE webhook_deliveries
        SET status = 'failed',
            attempts = ?,
            last_attempt_at = ?,
            next_retry_at = NULL,
            response_status = ?,
            error_message = ?
        WHERE id = ?
      `).run(newAttempts, now, responseStatus ?? null, errorMessage, id);

      // Then move to dead letter queue
      const dlqResult = moveToDeadLetter(id);
      if (!dlqResult.ok) {
        log.warn({ id, error: dlqResult.error.message }, 'Failed to move to dead letter queue');
      }

      log.warn({ id, attempts: newAttempts }, 'Delivery exhausted retries, moved to dead letter');
      return getDeliveryById(id);
    }

    // Calculate next retry with exponential backoff + jitter
    const nextRetryAt = calculateNextRetry(newAttempts - 1);

    db.prepare(`
      UPDATE webhook_deliveries
      SET status = 'pending',
          attempts = ?,
          last_attempt_at = ?,
          next_retry_at = ?,
          response_status = ?,
          error_message = ?
      WHERE id = ?
    `).run(newAttempts, now, nextRetryAt, responseStatus ?? null, errorMessage, id);

    log.info({ id, attempts: newAttempts, nextRetryAt }, 'Delivery failed, retry scheduled');
    return getDeliveryById(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, id }, 'Failed to mark delivery failed');
    return err('UPDATE_FAILED', msg);
  }
}

/**
 * Move a permanently failed delivery to the dead letter queue.
 * Sets delivery status to 'dead'.
 */
export function moveToDeadLetter(deliveryId: string): Result<WebhookDeadLetter> {
  try {
    const db = getDb();

    // Get delivery details
    const delivery = getDeliveryById(deliveryId);
    if (!delivery.ok) {
      return err('NOT_FOUND', `Delivery ${deliveryId} not found`);
    }

    const d = delivery.data;
    const dlqId = randomUUID();
    const now = toSqliteDatetime(new Date());

    // Insert into dead letter queue
    db.prepare(`
      INSERT INTO webhook_dead_letters (id, delivery_id, webhook_id, event_type, payload, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(dlqId, deliveryId, d.webhookId, d.eventType, d.payload, d.errorMessage, now);

    // Update delivery status to 'dead'
    db.prepare(`
      UPDATE webhook_deliveries SET status = 'dead' WHERE id = ?
    `).run(deliveryId);

    log.info({ dlqId, deliveryId, webhookId: d.webhookId }, 'Delivery moved to dead letter queue');

    return ok(rowToDeadLetter(
      db.prepare('SELECT * FROM webhook_dead_letters WHERE id = ?').get(dlqId) as Record<string, unknown>
    ));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, deliveryId }, 'Failed to move delivery to dead letter queue');
    return err('DLQ_FAILED', msg);
  }
}

/**
 * Get delivery history for a specific webhook, ordered by most recent first.
 */
export function getDeliveryHistory(
  webhookId: string,
  limit: number = 50,
): Result<WebhookDelivery[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE webhook_id = ?
      ORDER BY created_at DESC, ROWID DESC
      LIMIT ?
    `).all(webhookId, limit) as Record<string, unknown>[];

    const deliveries = rows.map(rowToDelivery);
    return ok(deliveries);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, webhookId }, 'Failed to get delivery history');
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Get all deliveries that are due for retry (status = 'pending' and next_retry_at <= now).
 * Uses SQLite datetime('now') for comparison to avoid format mismatches between
 * JS ISO strings and SQLite datetime format.
 */
export function getPendingRetries(): Result<WebhookDelivery[]> {
  try {
    const db = getDb();

    const rows = db.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE status = 'pending'
        AND attempts > 0
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= datetime('now')
      ORDER BY next_retry_at ASC
    `).all() as Record<string, unknown>[];

    const deliveries = rows.map(rowToDelivery);
    return ok(deliveries);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to get pending retries');
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Manually retry a dead-lettered delivery. Resets the delivery to pending
 * status with attempts reset and removes it from the dead letter queue.
 */
export function retryDelivery(deliveryId: string): Result<WebhookDelivery> {
  try {
    const db = getDb();

    // Verify delivery exists and is in a retryable state
    const existing = getDeliveryById(deliveryId);
    if (!existing.ok) {
      return existing;
    }

    const delivery = existing.data;
    if (delivery.status !== 'dead' && delivery.status !== 'failed') {
      return err('INVALID_STATE', `Delivery ${deliveryId} is not in a retryable state (current: ${delivery.status})`);
    }

    const now = toSqliteDatetime(new Date());

    // Reset delivery to pending with fresh attempt count
    db.prepare(`
      UPDATE webhook_deliveries
      SET status = 'pending',
          attempts = 0,
          last_attempt_at = NULL,
          next_retry_at = NULL,
          response_status = NULL,
          response_body = NULL,
          error_message = NULL,
          created_at = ?
      WHERE id = ?
    `).run(now, deliveryId);

    // Remove from dead letter queue if present
    db.prepare(`
      DELETE FROM webhook_dead_letters WHERE delivery_id = ?
    `).run(deliveryId);

    log.info({ deliveryId }, 'Delivery manually retried — reset to pending');
    return getDeliveryById(deliveryId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, deliveryId }, 'Failed to retry delivery');
    return err('RETRY_FAILED', msg);
  }
}

/**
 * Get dead letter entries for a specific webhook.
 */
export function getDeadLetters(
  webhookId: string,
  limit: number = 50,
): Result<WebhookDeadLetter[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM webhook_dead_letters
      WHERE webhook_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(webhookId, limit) as Record<string, unknown>[];

    const deadLetters = rows.map(rowToDeadLetter);
    return ok(deadLetters);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, webhookId }, 'Failed to get dead letters');
    return err('QUERY_FAILED', msg);
  }
}

// ── Internal Helpers ─────────────────────────────────────────────

/**
 * Get a single delivery by ID.
 */
function getDeliveryById(id: string): Result<WebhookDelivery> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Delivery ${id} not found`);

    return ok(rowToDelivery(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Convert a database row to a WebhookDelivery object.
 */
function rowToDelivery(row: Record<string, unknown>): WebhookDelivery {
  return {
    id: row.id as string,
    webhookId: row.webhook_id as string,
    eventType: row.event_type as string,
    payload: row.payload as string,
    status: row.status as DeliveryStatus,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    lastAttemptAt: (row.last_attempt_at as string) ?? null,
    nextRetryAt: (row.next_retry_at as string) ?? null,
    responseStatus: (row.response_status as number) ?? null,
    responseBody: (row.response_body as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Convert a database row to a WebhookDeadLetter object.
 */
function rowToDeadLetter(row: Record<string, unknown>): WebhookDeadLetter {
  return {
    id: row.id as string,
    deliveryId: row.delivery_id as string,
    webhookId: row.webhook_id as string,
    eventType: row.event_type as string,
    payload: row.payload as string,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: row.created_at as string,
  };
}
