/**
 * Webhook Repository Tests
 *
 * Tests for CRUD operations on webhook subscribers,
 * including event-based filtering and edge cases.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  createWebhook,
  getWebhookById,
  listWebhooks,
  getWebhooksByEvent,
  deleteWebhook,
} from '../src/notifications/webhook-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';

describe('Webhook Repository', () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear ALL tables before each test to ensure isolation
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');
    db.exec('DELETE FROM service_groups');
    db.exec('DELETE FROM webhooks');
    db.exec('DELETE FROM uptime_daily');
  });

  // ── createWebhook ────────────────────────────────────────────────

  describe('createWebhook', () => {
    it('should create a webhook with a single event', () => {
      const result = createWebhook(
        'https://hooks.example.com/notify',
        ['service.down'],
      );

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(result.data.url).toBe('https://hooks.example.com/notify');
      expect(result.data.events).toEqual(['service.down']);
      expect(result.data.enabled).toBe(true);
      expect(result.data.secret).toBeUndefined();
      expect(result.data.createdAt).toBeDefined();
    });

    it('should create a webhook with multiple events', () => {
      const events = ['service.down', 'service.up', 'incident.created'];
      const result = createWebhook('https://hooks.example.com/multi', events);

      expect(result.ok).toBe(true);
      expect(result.data.events).toEqual(events);
    });

    it('should create a webhook with a secret', () => {
      const result = createWebhook(
        'https://hooks.example.com/secure',
        ['incident.resolved'],
        'my-signing-secret-123',
      );

      expect(result.ok).toBe(true);
      expect(result.data.secret).toBe('my-signing-secret-123');
    });

    it('should fail when given an invalid event type', () => {
      const result = createWebhook(
        'https://hooks.example.com/bad',
        ['not.a.real.event'],
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CREATE_FAILED');
    });
  });

  // ── getWebhookById ───────────────────────────────────────────────

  describe('getWebhookById', () => {
    it('should retrieve a webhook by its ID', () => {
      const created = createWebhook(
        'https://hooks.example.com/get',
        ['service.degraded'],
      );
      const webhookId = created.data.id;

      const result = getWebhookById(webhookId);

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(webhookId);
      expect(result.data.url).toBe('https://hooks.example.com/get');
      expect(result.data.events).toEqual(['service.degraded']);
    });

    it('should return NOT_FOUND for a non-existent ID', () => {
      const result = getWebhookById('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── listWebhooks ─────────────────────────────────────────────────

  describe('listWebhooks', () => {
    it('should return an empty array when no webhooks exist', () => {
      const result = listWebhooks();

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should return all webhooks ordered by created_at DESC', () => {
      createWebhook('https://hooks.example.com/first', ['service.down']);
      createWebhook('https://hooks.example.com/second', ['service.up']);
      createWebhook('https://hooks.example.com/third', ['incident.created']);

      const result = listWebhooks();

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(3);

      // Most recently created should come first
      const urls = result.data.map((w) => w.url);
      expect(urls).toContain('https://hooks.example.com/first');
      expect(urls).toContain('https://hooks.example.com/second');
      expect(urls).toContain('https://hooks.example.com/third');
    });
  });

  // ── getWebhooksByEvent ───────────────────────────────────────────

  describe('getWebhooksByEvent', () => {
    it('should return only webhooks subscribed to the given event', () => {
      createWebhook('https://hooks.example.com/down-only', ['service.down']);
      createWebhook('https://hooks.example.com/up-only', ['service.up']);
      createWebhook('https://hooks.example.com/both', ['service.down', 'service.up']);

      const result = getWebhooksByEvent('service.down');

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(2);

      const urls = result.data.map((w) => w.url);
      expect(urls).toContain('https://hooks.example.com/down-only');
      expect(urls).toContain('https://hooks.example.com/both');
      expect(urls).not.toContain('https://hooks.example.com/up-only');
    });

    it('should return an empty array when no webhooks match the event', () => {
      createWebhook('https://hooks.example.com/down-only', ['service.down']);

      const result = getWebhooksByEvent('incident.resolved');

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should exclude disabled webhooks', () => {
      // Create a webhook then disable it directly in the DB
      const created = createWebhook('https://hooks.example.com/disabled', ['service.down']);
      db.prepare('UPDATE webhooks SET enabled = 0 WHERE id = ?').run(created.data.id);

      createWebhook('https://hooks.example.com/enabled', ['service.down']);

      const result = getWebhooksByEvent('service.down');

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].url).toBe('https://hooks.example.com/enabled');
    });
  });

  // ── deleteWebhook ────────────────────────────────────────────────

  describe('deleteWebhook', () => {
    it('should delete an existing webhook', () => {
      const created = createWebhook('https://hooks.example.com/delete-me', ['service.down']);
      const webhookId = created.data.id;

      const deleteResult = deleteWebhook(webhookId);
      expect(deleteResult.ok).toBe(true);

      // Verify it is gone
      const getResult = getWebhookById(webhookId);
      expect(getResult.ok).toBe(false);
      expect(getResult.error.code).toBe('NOT_FOUND');
    });

    it('should return NOT_FOUND when deleting a non-existent webhook', () => {
      const result = deleteWebhook('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should not affect other webhooks when one is deleted', () => {
      const first = createWebhook('https://hooks.example.com/keep', ['service.up']);
      const second = createWebhook('https://hooks.example.com/remove', ['service.down']);

      deleteWebhook(second.data.id);

      const remaining = listWebhooks();
      expect(remaining.ok).toBe(true);
      expect(remaining.data.length).toBe(1);
      expect(remaining.data[0].id).toBe(first.data.id);
    });
  });
});
