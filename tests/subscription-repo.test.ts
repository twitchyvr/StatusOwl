/**
 * Subscription Repository Tests
 *
 * Tests for CRUD operations on incident subscriptions,
 * including confirmation flow, unsubscribe, and service filtering.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createSubscription,
  confirmSubscription,
  unsubscribe,
  getSubscriptionsByService,
  listSubscriptions,
  deleteSubscription,
} from '../src/subscriptions/subscription-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';

describe('Subscription Repository', () => {
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
    db.exec('DELETE FROM subscriptions');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');
    db.exec('DELETE FROM service_groups');
  });

  /** Helper to insert a service for FK tests */
  function insertService(id?: string): string {
    const serviceId = id ?? randomUUID();
    db.prepare(
      "INSERT INTO services (id, name, url, method, expected_status, check_interval, timeout, status, enabled, sort_order, check_type) VALUES (?, ?, ?, 'GET', 200, 60, 10, 'unknown', 1, 0, 'http')"
    ).run(serviceId, `Service ${serviceId.slice(0, 8)}`, 'https://example.com');
    return serviceId;
  }

  // ── createSubscription ──────────────────────────────────────────

  describe('createSubscription', () => {
    it('should create a global subscription with email only', () => {
      const result = createSubscription('user@example.com');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.email).toBe('user@example.com');
      expect(result.data.serviceId).toBeNull();
      expect(result.data.confirmed).toBe(false);
      expect(result.data.confirmToken).toBeDefined();
      expect(result.data.confirmToken.length).toBe(64); // 32 bytes hex
      expect(result.data.unsubscribeToken).toBeDefined();
      expect(result.data.unsubscribeToken.length).toBe(64);
      expect(result.data.createdAt).toBeDefined();
    });

    it('should create a service-specific subscription with email + serviceId', () => {
      const serviceId = insertService();
      const result = createSubscription('user@example.com', serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.email).toBe('user@example.com');
      expect(result.data.serviceId).toBe(serviceId);
      expect(result.data.confirmed).toBe(false);
    });

    it('should reject duplicate email + serviceId combination', () => {
      const serviceId = insertService();
      createSubscription('dupe@example.com', serviceId);
      const result = createSubscription('dupe@example.com', serviceId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('DUPLICATE');
    });

    it('should generate unique tokens for each subscription', () => {
      const r1 = createSubscription('a@example.com');
      const r2 = createSubscription('b@example.com');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      expect(r1.data.confirmToken).not.toBe(r2.data.confirmToken);
      expect(r1.data.unsubscribeToken).not.toBe(r2.data.unsubscribeToken);
    });
  });

  // ── confirmSubscription ─────────────────────────────────────────

  describe('confirmSubscription', () => {
    it('should confirm a subscription with a valid token', () => {
      const created = createSubscription('confirm@example.com');
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = confirmSubscription(created.data.confirmToken);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.confirmed).toBe(true);
      expect(result.data.email).toBe('confirm@example.com');
    });

    it('should reject an invalid confirmation token', () => {
      const result = confirmSubscription('not-a-real-token');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── unsubscribe ─────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('should remove a subscription with a valid unsubscribe token', () => {
      const created = createSubscription('unsub@example.com');
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = unsubscribe(created.data.unsubscribeToken);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.deleted).toBe(true);

      // Verify it's actually gone
      const list = listSubscriptions();
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.data.length).toBe(0);
    });

    it('should reject an invalid unsubscribe token', () => {
      const result = unsubscribe('bogus-token');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── getSubscriptionsByService ───────────────────────────────────

  describe('getSubscriptionsByService', () => {
    it('should return confirmed subscriptions for a service (service-specific + global)', () => {
      const serviceId = insertService();

      // Service-specific subscription (confirmed)
      const s1 = createSubscription('svc@example.com', serviceId);
      expect(s1.ok).toBe(true);
      if (!s1.ok) return;
      confirmSubscription(s1.data.confirmToken);

      // Global subscription (confirmed)
      const s2 = createSubscription('global@example.com');
      expect(s2.ok).toBe(true);
      if (!s2.ok) return;
      confirmSubscription(s2.data.confirmToken);

      const result = getSubscriptionsByService(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(2);
      const emails = result.data.map(s => s.email);
      expect(emails).toContain('svc@example.com');
      expect(emails).toContain('global@example.com');
    });

    it('should exclude unconfirmed subscriptions', () => {
      const serviceId = insertService();

      // Confirmed
      const s1 = createSubscription('confirmed@example.com', serviceId);
      expect(s1.ok).toBe(true);
      if (!s1.ok) return;
      confirmSubscription(s1.data.confirmToken);

      // Unconfirmed (never call confirmSubscription)
      createSubscription('unconfirmed@example.com', serviceId);

      const result = getSubscriptionsByService(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].email).toBe('confirmed@example.com');
    });
  });

  // ── listSubscriptions ──────────────────────────────────────────

  describe('listSubscriptions', () => {
    it('should return all subscriptions (confirmed and unconfirmed)', () => {
      const s1 = createSubscription('one@example.com');
      expect(s1.ok).toBe(true);
      if (!s1.ok) return;
      confirmSubscription(s1.data.confirmToken);

      createSubscription('two@example.com');

      const result = listSubscriptions();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(2);
    });

    it('should return empty array when no subscriptions exist', () => {
      const result = listSubscriptions();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    });
  });

  // ── deleteSubscription ─────────────────────────────────────────

  describe('deleteSubscription', () => {
    it('should remove a subscription by id', () => {
      const created = createSubscription('del@example.com');
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = deleteSubscription(created.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.deleted).toBe(true);

      // Verify gone
      const list = listSubscriptions();
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.data.length).toBe(0);
    });

    it('should return NOT_FOUND for a missing id', () => {
      const result = deleteSubscription(randomUUID());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });
});
