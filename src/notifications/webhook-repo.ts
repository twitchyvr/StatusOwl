/**
 * StatusOwl — Webhook Repository
 *
 * CRUD operations for webhook subscribers.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, Webhook, WebhookEventType } from '../core/index.js';
import { WebhookEventType as WebhookEventTypeSchema } from '../core/index.js';

const log = createChildLogger('WebhookRepo');

/**
 * Create a new webhook subscription.
 */
export function createWebhook(
  url: string,
  events: string[],
  secret?: string,
): Result<Webhook> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    // Validate events
    const parsedEvents = WebhookEventTypeSchema.array().parse(events);

    db.prepare(`
      INSERT INTO webhooks (id, url, secret, events, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, url, secret ?? null, JSON.stringify(parsedEvents), now);

    log.info({ id, url, events: parsedEvents }, 'Webhook created');
    return getWebhookById(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, url }, 'Failed to create webhook');
    return err('CREATE_FAILED', msg);
  }
}

/**
 * Delete a webhook by ID.
 */
export function deleteWebhook(id: string): Result<void> {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);

    if (result.changes === 0) {
      return err('NOT_FOUND', `Webhook ${id} not found`);
    }

    log.info({ id }, 'Webhook deleted');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, id }, 'Failed to delete webhook');
    return err('DELETE_FAILED', msg);
  }
}

/**
 * List all webhooks.
 */
export function listWebhooks(): Result<Webhook[]> {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as Record<string, unknown>[];

    const webhooks = rows.map((row) => rowToWebhook(row));
    return ok(webhooks);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to list webhooks');
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Get a webhook by ID.
 */
export function getWebhookById(id: string): Result<Webhook> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Webhook ${id} not found`);

    return ok(rowToWebhook(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Get all webhooks subscribed to a specific event.
 */
export function getWebhooksByEvent(event: WebhookEventType): Result<Webhook[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM webhooks
      WHERE enabled = 1
      ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];

    // Filter to only webhooks subscribed to this event
    const webhooks = rows
      .map((row) => rowToWebhook(row))
      .filter((webhook) => webhook.events.includes(event));

    return ok(webhooks);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, event }, 'Failed to get webhooks by event');
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Convert a database row to a Webhook object.
 */
function rowToWebhook(row: Record<string, unknown>): Webhook {
  const eventsStr = row.events as string;
  let events: WebhookEventType[] = [];

  try {
    events = JSON.parse(eventsStr) as WebhookEventType[];
  } catch {
    events = [];
  }

  return {
    id: row.id as string,
    url: row.url as string,
    secret: (row.secret as string) ?? undefined,
    events,
    enabled: (row.enabled as number) === 1,
    createdAt: (row.created_at as string) ?? undefined,
  };
}
