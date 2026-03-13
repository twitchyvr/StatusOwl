/**
 * StatusOwl — Subscription Repository
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { createChildLogger, ok, err } from '../core/index.js';
import { getDb } from '../storage/database.js';
import type { Result, Subscription } from '../core/index.js';

const log = createChildLogger('SubscriptionRepo');

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function rowToSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    email: row.email as string,
    serviceId: row.service_id as string | null,
    confirmed: (row.confirmed as number) === 1,
    confirmToken: row.confirm_token as string,
    unsubscribeToken: row.unsubscribe_token as string,
    createdAt: row.created_at as string,
  };
}

export function createSubscription(email: string, serviceId?: string): Result<Subscription> {
  try {
    const db = getDb();
    const id = randomUUID();
    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO subscriptions (id, email, service_id, confirm_token, unsubscribe_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, serviceId ?? null, confirmToken, unsubscribeToken, now);

    log.info({ email, serviceId }, 'Subscription created (pending confirmation)');

    return ok({
      id, email, serviceId: serviceId ?? null, confirmed: false,
      confirmToken, unsubscribeToken, createdAt: now,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint')) {
      return err('DUPLICATE', 'This email is already subscribed to this service');
    }
    return err('DB_ERROR', msg);
  }
}

export function confirmSubscription(token: string): Result<Subscription> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM subscriptions WHERE confirm_token = ?').get(token) as Record<string, unknown> | undefined;
    if (!row) return err('NOT_FOUND', 'Invalid confirmation token');

    db.prepare('UPDATE subscriptions SET confirmed = 1 WHERE id = ?').run(row.id);
    log.info({ email: row.email }, 'Subscription confirmed');

    return ok({ ...rowToSubscription(row), confirmed: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function unsubscribe(token: string): Result<{ deleted: true }> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM subscriptions WHERE unsubscribe_token = ?').run(token);
    if (result.changes === 0) return err('NOT_FOUND', 'Invalid unsubscribe token');
    log.info('Subscription removed via unsubscribe token');
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function getSubscriptionsByService(serviceId: string): Result<Subscription[]> {
  try {
    const db = getDb();
    // Get subscriptions for this specific service + global subscriptions (service_id IS NULL)
    const rows = db.prepare(
      'SELECT * FROM subscriptions WHERE confirmed = 1 AND (service_id = ? OR service_id IS NULL) ORDER BY created_at'
    ).all(serviceId) as Record<string, unknown>[];
    return ok(rows.map(rowToSubscription));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function listSubscriptions(): Result<Subscription[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return ok(rows.map(rowToSubscription));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

export function deleteSubscription(id: string): Result<{ deleted: true }> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
    if (result.changes === 0) return err('NOT_FOUND', `Subscription ${id} not found`);
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}
