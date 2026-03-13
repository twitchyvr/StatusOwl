/**
 * Webhook Delivery Tests
 *
 * Tests for webhook delivery lifecycle including recording, success/failure
 * tracking, exponential backoff retry calculation, dead letter queue movement,
 * delivery history queries, and manual retry functionality.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import {
  recordDelivery,
  markDeliverySuccess,
  markDeliveryFailed,
  moveToDeadLetter,
  getDeliveryHistory,
  getPendingRetries,
  retryDelivery,
  getDeadLetters,
  calculateNextRetry,
} from '../src/notifications/webhook-delivery.js';
import { createWebhook } from '../src/notifications/webhook-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';

describe('Webhook Delivery', () => {
  let db: ReturnType<typeof getDb>;
  let webhookId: string;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear tables for test isolation
    db.exec('DELETE FROM webhook_dead_letters');
    db.exec('DELETE FROM webhook_deliveries');
    db.exec('DELETE FROM webhooks');

    // Create a webhook to use in tests
    const result = createWebhook('https://hooks.example.com/test', ['service.down', 'service.up']);
    if (!result.ok) throw new Error('Failed to create test webhook');
    webhookId = result.data.id;
  });

  // ── recordDelivery ──────────────────────────────────────────────

  describe('recordDelivery', () => {
    it('should create a pending delivery record', () => {
      const payload = { event: 'service.down', serviceId: 'svc-1' };
      const result = recordDelivery(webhookId, 'service.down', payload);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.id).toBeDefined();
      expect(result.data.webhookId).toBe(webhookId);
      expect(result.data.eventType).toBe('service.down');
      expect(result.data.status).toBe('pending');
      expect(result.data.attempts).toBe(0);
      expect(result.data.maxAttempts).toBe(5);
      expect(result.data.lastAttemptAt).toBeNull();
      expect(result.data.nextRetryAt).toBeNull();
      expect(result.data.responseStatus).toBeNull();
      expect(result.data.responseBody).toBeNull();
      expect(result.data.errorMessage).toBeNull();
      expect(result.data.createdAt).toBeDefined();
    });

    it('should store the payload as JSON', () => {
      const payload = { event: 'service.down', data: { name: 'API', url: 'https://api.example.com' } };
      const result = recordDelivery(webhookId, 'service.down', payload);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const parsed = JSON.parse(result.data.payload);
      expect(parsed.event).toBe('service.down');
      expect(parsed.data.name).toBe('API');
    });

    it('should fail with invalid webhook ID (foreign key constraint)', () => {
      const result = recordDelivery('00000000-0000-0000-0000-000000000000', 'service.down', {});

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('CREATE_FAILED');
    });
  });

  // ── markDeliverySuccess ─────────────────────────────────────────

  describe('markDeliverySuccess', () => {
    it('should mark a delivery as successful', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      const result = markDeliverySuccess(delivery.data.id, 200, '{"received": true}');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.status).toBe('success');
      expect(result.data.attempts).toBe(1);
      expect(result.data.responseStatus).toBe(200);
      expect(result.data.responseBody).toBe('{"received": true}');
      expect(result.data.lastAttemptAt).toBeDefined();
      expect(result.data.nextRetryAt).toBeNull();
    });

    it('should return NOT_FOUND for non-existent delivery', () => {
      const result = markDeliverySuccess('00000000-0000-0000-0000-000000000000', 200, 'ok');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── markDeliveryFailed ──────────────────────────────────────────

  describe('markDeliveryFailed', () => {
    it('should increment attempts and schedule retry', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      const result = markDeliveryFailed(delivery.data.id, 'Connection timeout', 500);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.status).toBe('pending');
      expect(result.data.attempts).toBe(1);
      expect(result.data.errorMessage).toBe('Connection timeout');
      expect(result.data.responseStatus).toBe(500);
      expect(result.data.nextRetryAt).toBeDefined();
      expect(result.data.lastAttemptAt).toBeDefined();
    });

    it('should keep delivery pending through multiple failures below max', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      // Fail 4 times (max is 5)
      let lastResult = markDeliveryFailed(delivery.data.id, 'Fail 1');
      expect(lastResult.ok).toBe(true);
      if (!lastResult.ok) return;
      expect(lastResult.data.attempts).toBe(1);
      expect(lastResult.data.status).toBe('pending');

      lastResult = markDeliveryFailed(delivery.data.id, 'Fail 2');
      expect(lastResult.ok).toBe(true);
      if (!lastResult.ok) return;
      expect(lastResult.data.attempts).toBe(2);
      expect(lastResult.data.status).toBe('pending');

      lastResult = markDeliveryFailed(delivery.data.id, 'Fail 3');
      expect(lastResult.ok).toBe(true);
      if (!lastResult.ok) return;
      expect(lastResult.data.attempts).toBe(3);
      expect(lastResult.data.status).toBe('pending');

      lastResult = markDeliveryFailed(delivery.data.id, 'Fail 4');
      expect(lastResult.ok).toBe(true);
      if (!lastResult.ok) return;
      expect(lastResult.data.attempts).toBe(4);
      expect(lastResult.data.status).toBe('pending');
    });

    it('should move to dead letter queue after exhausting max attempts', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      // Fail 5 times to exhaust retries
      for (let i = 0; i < 4; i++) {
        markDeliveryFailed(delivery.data.id, 'fail ' + (i + 1));
      }

      const finalResult = markDeliveryFailed(delivery.data.id, 'Final failure');

      expect(finalResult.ok).toBe(true);
      if (!finalResult.ok) return;
      expect(finalResult.data.status).toBe('dead');
      expect(finalResult.data.attempts).toBe(5);
      expect(finalResult.data.nextRetryAt).toBeNull();

      // Verify it landed in the dead letter queue
      const dlq = getDeadLetters(webhookId);
      expect(dlq.ok).toBe(true);
      if (!dlq.ok) return;
      expect(dlq.data.length).toBe(1);
      expect(dlq.data[0].deliveryId).toBe(delivery.data.id);
    });

    it('should store error message without response status', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      const result = markDeliveryFailed(delivery.data.id, 'DNS resolution failed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.errorMessage).toBe('DNS resolution failed');
      expect(result.data.responseStatus).toBeNull();
    });

    it('should return NOT_FOUND for non-existent delivery', () => {
      const result = markDeliveryFailed('00000000-0000-0000-0000-000000000000', 'error');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── calculateNextRetry (exponential backoff) ───────────────────

  describe('calculateNextRetry', () => {
    it('should produce increasing delays with exponential backoff', () => {
      // Mock Math.random to return 0.5 for predictable results (zero jitter)
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // Capture the results — they're SQLite datetimes (YYYY-MM-DD HH:MM:SS)
      const result0 = calculateNextRetry(0);
      const result1 = calculateNextRetry(1);
      const result2 = calculateNextRetry(2);
      const result3 = calculateNextRetry(3);
      const result4 = calculateNextRetry(4);

      // Each subsequent retry should be further in the future
      expect(result1 > result0).toBe(true);
      expect(result2 > result1).toBe(true);
      expect(result3 > result2).toBe(true);
      expect(result4 > result3).toBe(true);

      randomSpy.mockRestore();
    });

    it('should return a valid SQLite-compatible datetime string', () => {
      const result = calculateNextRetry(0);
      // Format: YYYY-MM-DD HH:MM:SS
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should produce a time in the future', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const beforeCall = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      const result = calculateNextRetry(0);
      // Result should be >= the time before the call (it is in the future)
      expect(result >= beforeCall).toBe(true);
      randomSpy.mockRestore();
    });

    it('should apply jitter producing different results at min and max random', () => {
      // Use attempt=4 (base delay 16s) so jitter range (8s) is larger than
      // the 1-second truncation in SQLite datetime format
      // With random=0 (min jitter -25%), delay = 16000 - 4000 = 12s
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const retryMin = calculateNextRetry(4);

      // With random=1 (max jitter +25%), delay = 16000 + 4000 = 20s
      randomSpy.mockReturnValue(1);
      const retryMax = calculateNextRetry(4);

      // Max jitter should produce a later datetime than min jitter
      // 20s vs 12s difference is well beyond the 1-second precision
      expect(retryMax > retryMin).toBe(true);

      randomSpy.mockRestore();
    });
  });

  // ── moveToDeadLetter ────────────────────────────────────────────

  describe('moveToDeadLetter', () => {
    it('should move a delivery to the dead letter queue', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      // Fail once to set an error message
      markDeliveryFailed(delivery.data.id, 'Test error');

      const result = moveToDeadLetter(delivery.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.id).toBeDefined();
      expect(result.data.deliveryId).toBe(delivery.data.id);
      expect(result.data.webhookId).toBe(webhookId);
      expect(result.data.eventType).toBe('service.down');
      expect(result.data.errorMessage).toBe('Test error');
      expect(result.data.createdAt).toBeDefined();
    });

    it('should set delivery status to dead after moving to DLQ', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      moveToDeadLetter(delivery.data.id);

      // Re-check delivery status via history
      const history = getDeliveryHistory(webhookId);
      expect(history.ok).toBe(true);
      if (!history.ok) return;

      const updated = history.data.find(d => d.id === delivery.data.id);
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('dead');
    });

    it('should return NOT_FOUND for non-existent delivery', () => {
      const result = moveToDeadLetter('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── getDeliveryHistory ──────────────────────────────────────────

  describe('getDeliveryHistory', () => {
    it('should return empty array when no deliveries exist', () => {
      const result = getDeliveryHistory(webhookId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    });

    it('should return all deliveries ordered by created_at DESC', () => {
      // Insert deliveries with manually staggered timestamps to ensure ordering
      const d1 = recordDelivery(webhookId, 'service.down', { seq: 1 });
      const d2 = recordDelivery(webhookId, 'service.up', { seq: 2 });
      const d3 = recordDelivery(webhookId, 'service.down', { seq: 3 });
      if (!d1.ok || !d2.ok || !d3.ok) throw new Error('Setup failed');

      // Manually stagger created_at so ordering is deterministic
      db.prepare("UPDATE webhook_deliveries SET created_at = '2025-01-01 00:00:01' WHERE id = ?").run(d1.data.id);
      db.prepare("UPDATE webhook_deliveries SET created_at = '2025-01-01 00:00:02' WHERE id = ?").run(d2.data.id);
      db.prepare("UPDATE webhook_deliveries SET created_at = '2025-01-01 00:00:03' WHERE id = ?").run(d3.data.id);

      const result = getDeliveryHistory(webhookId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);

      // Most recent first (seq: 3 -> 2 -> 1)
      const payloads = result.data.map(d => JSON.parse(d.payload).seq);
      expect(payloads[0]).toBe(3);
      expect(payloads[1]).toBe(2);
      expect(payloads[2]).toBe(1);
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        recordDelivery(webhookId, 'service.down', { seq: i });
      }

      const result = getDeliveryHistory(webhookId, 3);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);
    });

    it('should only return deliveries for the specified webhook', () => {
      // Create a second webhook
      const wh2 = createWebhook('https://hooks.example.com/other', ['service.down']);
      if (!wh2.ok) throw new Error('Setup failed');

      recordDelivery(webhookId, 'service.down', { owner: 'wh1' });
      recordDelivery(wh2.data.id, 'service.down', { owner: 'wh2' });

      const result = getDeliveryHistory(webhookId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(1);
      expect(JSON.parse(result.data[0].payload).owner).toBe('wh1');
    });
  });

  // ── getPendingRetries ───────────────────────────────────────────

  describe('getPendingRetries', () => {
    it('should return deliveries due for retry', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      // Fail once to schedule a retry
      markDeliveryFailed(delivery.data.id, 'Timeout');

      // Manually set next_retry_at to the past so it is due
      db.prepare(
        "UPDATE webhook_deliveries SET next_retry_at = datetime('now', '-1 minute') WHERE id = ?"
      ).run(delivery.data.id);

      const result = getPendingRetries();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(delivery.data.id);
    });

    it('should not return brand-new pending deliveries with zero attempts', () => {
      // A fresh delivery has attempts=0 and no next_retry_at — not a retry
      recordDelivery(webhookId, 'service.down', { event: 'test' });

      const result = getPendingRetries();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });

    it('should not return deliveries not yet due', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      markDeliveryFailed(delivery.data.id, 'Timeout');

      // Set next_retry_at far in the future
      db.prepare(
        "UPDATE webhook_deliveries SET next_retry_at = datetime('now', '+1 hour') WHERE id = ?"
      ).run(delivery.data.id);

      const result = getPendingRetries();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });

    it('should not return dead or successful deliveries', () => {
      const d1 = recordDelivery(webhookId, 'service.down', { event: 'success' });
      const d2 = recordDelivery(webhookId, 'service.down', { event: 'dead' });
      if (!d1.ok || !d2.ok) throw new Error('Setup failed');

      markDeliverySuccess(d1.data.id, 200, 'ok');

      // Exhaust retries on d2
      for (let i = 0; i < 5; i++) {
        markDeliveryFailed(d2.data.id, 'fail ' + i);
      }

      const result = getPendingRetries();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });
  });

  // ── retryDelivery ───────────────────────────────────────────────

  describe('retryDelivery', () => {
    it('should reset a dead delivery to pending state', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      // Exhaust retries
      for (let i = 0; i < 5; i++) {
        markDeliveryFailed(delivery.data.id, 'fail ' + i);
      }

      // Verify it is dead
      const history = getDeliveryHistory(webhookId);
      if (!history.ok) throw new Error('Query failed');
      const deadDelivery = history.data.find(d => d.id === delivery.data.id);
      expect(deadDelivery!.status).toBe('dead');

      // Retry it
      const result = retryDelivery(delivery.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('pending');
      expect(result.data.attempts).toBe(0);
      expect(result.data.errorMessage).toBeNull();
      expect(result.data.responseStatus).toBeNull();
      expect(result.data.responseBody).toBeNull();
      expect(result.data.nextRetryAt).toBeNull();
    });

    it('should remove the entry from the dead letter queue after retry', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      for (let i = 0; i < 5; i++) {
        markDeliveryFailed(delivery.data.id, 'fail ' + i);
      }

      // Verify DLQ entry exists
      const dlqBefore = getDeadLetters(webhookId);
      expect(dlqBefore.ok).toBe(true);
      if (!dlqBefore.ok) return;
      expect(dlqBefore.data.length).toBe(1);

      // Retry
      retryDelivery(delivery.data.id);

      // DLQ should be empty
      const dlqAfter = getDeadLetters(webhookId);
      expect(dlqAfter.ok).toBe(true);
      if (!dlqAfter.ok) return;
      expect(dlqAfter.data.length).toBe(0);
    });

    it('should reject retry for a pending delivery', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      const result = retryDelivery(delivery.data.id);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_STATE');
    });

    it('should reject retry for a successful delivery', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'test' });
      if (!delivery.ok) throw new Error('Setup failed');

      markDeliverySuccess(delivery.data.id, 200, 'ok');

      const result = retryDelivery(delivery.data.id);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_STATE');
    });

    it('should return NOT_FOUND for non-existent delivery', () => {
      const result = retryDelivery('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── getDeadLetters ──────────────────────────────────────────────

  describe('getDeadLetters', () => {
    it('should return empty array when no dead letters exist', () => {
      const result = getDeadLetters(webhookId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    });

    it('should return dead letter entries with all fields populated', () => {
      const delivery = recordDelivery(webhookId, 'service.down', { event: 'dlq-test' });
      if (!delivery.ok) throw new Error('Setup failed');

      for (let i = 0; i < 5; i++) {
        markDeliveryFailed(delivery.data.id, 'failure #' + (i + 1));
      }

      const result = getDeadLetters(webhookId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(1);

      const dlqEntry = result.data[0];
      expect(dlqEntry.deliveryId).toBe(delivery.data.id);
      expect(dlqEntry.webhookId).toBe(webhookId);
      expect(dlqEntry.eventType).toBe('service.down');
      expect(JSON.parse(dlqEntry.payload).event).toBe('dlq-test');
      expect(dlqEntry.createdAt).toBeDefined();
    });
  });
});
