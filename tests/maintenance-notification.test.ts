/**
 * Maintenance Notification Tests
 *
 * Tests for the maintenance notification scheduler: pre-notification
 * timing, start/end triggers, duplicate prevention, webhook dispatch,
 * SSE broadcasting, and notification tracking persistence.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { getDb, closeDb } from '../src/storage/database.js';
import { createService } from '../src/storage/index.js';
import { createMaintenanceWindow } from '../src/maintenance/maintenance-repo.js';
import { createWebhook } from '../src/notifications/webhook-repo.js';
import {
  checkMaintenanceWindows,
  startMaintenanceNotifier,
  stopMaintenanceNotifier,
  hasNotificationBeenSent,
  recordNotificationSent,
  getNotificationsForWindow,
} from '../src/maintenance/notification-scheduler.js';

// Mock fetch for webhook delivery
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

// Mock the event bus
const mockBroadcast = vi.fn();
vi.mock('../src/api/event-stream.js', () => ({
  getEventBus: () => ({
    broadcast: mockBroadcast,
  }),
}));

// Mock nodemailer to avoid real SMTP connections
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    }),
  },
}));

describe('Maintenance Notification Scheduler', () => {
  let db: ReturnType<typeof getDb>;
  let serviceId: string;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    stopMaintenanceNotifier();
    closeDb();
  });

  beforeEach(() => {
    // Clear tables in FK-safe order
    db.exec('DELETE FROM maintenance_notifications');
    db.exec('DELETE FROM maintenance_windows');
    db.exec('DELETE FROM webhook_dead_letters');
    db.exec('DELETE FROM webhook_deliveries');
    db.exec('DELETE FROM webhooks');
    db.exec('DELETE FROM subscriptions');
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');

    // Reset mocks
    mockFetch.mockReset();
    mockBroadcast.mockReset();

    // Default fetch to return OK
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }));

    // Create a test service
    const result = createService({
      name: 'Notification Test Service',
      url: 'https://api.example.com/health',
    });
    expect(result.ok).toBe(true);
    serviceId = result.data.id;
  });

  // ── Notification State Tracking ─────────────────────────────────────

  describe('notification state tracking', () => {
    it('should record a notification as sent', () => {
      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Test Window',
        startAt: '2026-06-01T02:00:00.000Z',
        endAt: '2026-06-01T04:00:00.000Z',
      });
      expect(windowResult.ok).toBe(true);
      const windowId = windowResult.data.id;

      const result = recordNotificationSent(windowId, 'upcoming');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.maintenanceWindowId).toBe(windowId);
        expect(result.data.notificationType).toBe('upcoming');
        expect(result.data.sentAt).toBeDefined();
        expect(result.data.id).toBeDefined();
      }
    });

    it('should detect when a notification has been sent', () => {
      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Test Window',
        startAt: '2026-06-01T02:00:00.000Z',
        endAt: '2026-06-01T04:00:00.000Z',
      });
      expect(windowResult.ok).toBe(true);
      const windowId = windowResult.data.id;

      expect(hasNotificationBeenSent(windowId, 'upcoming')).toBe(false);

      recordNotificationSent(windowId, 'upcoming');

      expect(hasNotificationBeenSent(windowId, 'upcoming')).toBe(true);
    });

    it('should track different notification types independently', () => {
      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Test Window',
        startAt: '2026-06-01T02:00:00.000Z',
        endAt: '2026-06-01T04:00:00.000Z',
      });
      expect(windowResult.ok).toBe(true);
      const windowId = windowResult.data.id;

      recordNotificationSent(windowId, 'upcoming');

      expect(hasNotificationBeenSent(windowId, 'upcoming')).toBe(true);
      expect(hasNotificationBeenSent(windowId, 'started')).toBe(false);
      expect(hasNotificationBeenSent(windowId, 'ended')).toBe(false);
    });

    it('should prevent duplicate notification recording', () => {
      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Test Window',
        startAt: '2026-06-01T02:00:00.000Z',
        endAt: '2026-06-01T04:00:00.000Z',
      });
      expect(windowResult.ok).toBe(true);
      const windowId = windowResult.data.id;

      const first = recordNotificationSent(windowId, 'started');
      expect(first.ok).toBe(true);

      const second = recordNotificationSent(windowId, 'started');
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.code).toBe('DUPLICATE');
      }
    });

    it('should retrieve all notifications for a window', () => {
      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Test Window',
        startAt: '2026-06-01T02:00:00.000Z',
        endAt: '2026-06-01T04:00:00.000Z',
      });
      expect(windowResult.ok).toBe(true);
      const windowId = windowResult.data.id;

      recordNotificationSent(windowId, 'upcoming');
      recordNotificationSent(windowId, 'started');
      recordNotificationSent(windowId, 'ended');

      const result = getNotificationsForWindow(windowId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(3);
        const types = result.data.map((n) => n.notificationType);
        expect(types).toContain('upcoming');
        expect(types).toContain('started');
        expect(types).toContain('ended');
      }
    });

    it('should return empty array for window with no notifications', () => {
      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Silent Window',
        startAt: '2026-06-01T02:00:00.000Z',
        endAt: '2026-06-01T04:00:00.000Z',
      });
      expect(windowResult.ok).toBe(true);

      const result = getNotificationsForWindow(windowResult.data.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(0);
      }
    });
  });

  // ── Pre-notification Timing ─────────────────────────────────────────

  describe('pre-notification timing (upcoming)', () => {
    it('should send upcoming notification when window starts within 1 hour', async () => {
      const now = Date.now();
      const thirtyMinutes = 30 * 60 * 1000;
      const twoHours = 2 * 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Starting soon',
        startAt: new Date(now + thirtyMinutes).toISOString(),
        endAt: new Date(now + twoHours).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      await checkMaintenanceWindows();

      // Should have broadcast an 'upcoming' SSE event
      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.upcoming',
        expect.objectContaining({
          maintenanceWindowId: windowResult.data.id,
          notificationType: 'upcoming',
        }),
      );

      // Should have recorded the notification
      expect(hasNotificationBeenSent(windowResult.data.id, 'upcoming')).toBe(true);
    });

    it('should NOT send upcoming notification for windows more than 1 hour away', async () => {
      const now = Date.now();
      const twoHours = 2 * 60 * 60 * 1000;
      const fourHours = 4 * 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'Far future',
        startAt: new Date(now + twoHours).toISOString(),
        endAt: new Date(now + fourHours).toISOString(),
      });

      await checkMaintenanceWindows();

      // No upcoming broadcast
      const upcomingCalls = mockBroadcast.mock.calls.filter(
        (c: [string, unknown]) => c[0] === 'maintenance.upcoming',
      );
      expect(upcomingCalls.length).toBe(0);
    });

    it('should NOT send upcoming notification for already-started windows', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'Already active',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });

      await checkMaintenanceWindows();

      // Should see 'started' but NOT 'upcoming'
      const upcomingCalls = mockBroadcast.mock.calls.filter(
        (c: [string, unknown]) => c[0] === 'maintenance.upcoming',
      );
      expect(upcomingCalls.length).toBe(0);
    });
  });

  // ── Start Notification ──────────────────────────────────────────────

  describe('started notification', () => {
    it('should send started notification for active maintenance window', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Active maintenance',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      await checkMaintenanceWindows();

      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.started',
        expect.objectContaining({
          maintenanceWindowId: windowResult.data.id,
          notificationType: 'started',
        }),
      );

      expect(hasNotificationBeenSent(windowResult.data.id, 'started')).toBe(true);
    });
  });

  // ── End Notification ────────────────────────────────────────────────

  describe('ended notification', () => {
    it('should send ended notification for completed maintenance window', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const twoHours = 2 * 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Completed maintenance',
        startAt: new Date(now - twoHours).toISOString(),
        endAt: new Date(now - oneHour).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      await checkMaintenanceWindows();

      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.ended',
        expect.objectContaining({
          maintenanceWindowId: windowResult.data.id,
          notificationType: 'ended',
        }),
      );

      expect(hasNotificationBeenSent(windowResult.data.id, 'ended')).toBe(true);
    });
  });

  // ── Duplicate Prevention ────────────────────────────────────────────

  describe('duplicate prevention', () => {
    it('should NOT send the same notification type twice for the same window', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'No duplicates',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      // First check — should send 'started'
      await checkMaintenanceWindows();
      expect(mockBroadcast).toHaveBeenCalledTimes(1);

      mockBroadcast.mockClear();

      // Second check — should NOT send 'started' again
      await checkMaintenanceWindows();
      expect(mockBroadcast).not.toHaveBeenCalledWith(
        'maintenance.started',
        expect.anything(),
      );
    });

    it('should send different notification types for the same window', async () => {
      const now = Date.now();
      const thirtyMin = 30 * 60 * 1000;
      const twoHours = 2 * 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Multi-phase',
        startAt: new Date(now + thirtyMin).toISOString(),
        endAt: new Date(now + twoHours).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      // First check — upcoming (within 1 hour)
      await checkMaintenanceWindows();

      const result = getNotificationsForWindow(windowResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(1);
        expect(result.data[0].notificationType).toBe('upcoming');
      }
    });
  });

  // ── Webhook Integration ─────────────────────────────────────────────

  describe('webhook dispatch', () => {
    it('should deliver maintenance notifications to enabled webhooks', async () => {
      // Create a webhook
      const webhookResult = createWebhook(
        'https://hooks.example.com/maintenance',
        ['service.down'],
      );
      expect(webhookResult.ok).toBe(true);

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'Webhook test',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });

      await checkMaintenanceWindows();

      // Verify fetch was called with the webhook URL
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.example.com/maintenance',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('maintenance.started'),
        }),
      );
    });

    it('should include HMAC signature when webhook has a secret', async () => {
      const webhookResult = createWebhook(
        'https://hooks.example.com/signed',
        ['service.down'],
        'my-secret-key',
      );
      expect(webhookResult.ok).toBe(true);

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'Signed webhook test',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });

      await checkMaintenanceWindows();

      // Verify the fetch call included a signature header
      const fetchCall = mockFetch.mock.calls.find(
        (call: [string | URL | Request, RequestInit | undefined]) => {
          const url = call[0];
          return typeof url === 'string' && url.includes('signed');
        },
      );
      expect(fetchCall).toBeDefined();
      if (fetchCall) {
        const opts = fetchCall[1] as RequestInit;
        const headers = opts.headers as Record<string, string>;
        expect(headers['X-StatusOwl-Signature']).toMatch(/^sha256=[a-f0-9]+$/);
      }
    });

    it('should not fail when webhook delivery returns an error', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

      createWebhook('https://hooks.example.com/failing', ['service.down']);

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Error resilience test',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      // Should not throw
      await expect(checkMaintenanceWindows()).resolves.not.toThrow();

      // Notification should still be recorded (delivery failure does not block recording)
      expect(hasNotificationBeenSent(windowResult.data.id, 'started')).toBe(true);
    });

    it('should not fail when no webhooks are configured', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'No webhooks',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });

      // Should complete without errors
      await expect(checkMaintenanceWindows()).resolves.not.toThrow();
    });
  });

  // ── SSE Broadcasting ───────────────────────────────────────────────

  describe('SSE broadcasting', () => {
    it('should broadcast maintenance.upcoming SSE event', async () => {
      const now = Date.now();
      const thirtyMin = 30 * 60 * 1000;
      const twoHours = 2 * 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'SSE upcoming',
        startAt: new Date(now + thirtyMin).toISOString(),
        endAt: new Date(now + twoHours).toISOString(),
      });

      await checkMaintenanceWindows();

      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.upcoming',
        expect.objectContaining({
          title: 'SSE upcoming',
          serviceId,
          notificationType: 'upcoming',
        }),
      );
    });

    it('should broadcast maintenance.started SSE event', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'SSE started',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });

      await checkMaintenanceWindows();

      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.started',
        expect.objectContaining({
          title: 'SSE started',
          serviceId,
          notificationType: 'started',
        }),
      );
    });

    it('should broadcast maintenance.ended SSE event', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const twoHours = 2 * 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'SSE ended',
        startAt: new Date(now - twoHours).toISOString(),
        endAt: new Date(now - oneHour).toISOString(),
      });

      await checkMaintenanceWindows();

      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.ended',
        expect.objectContaining({
          title: 'SSE ended',
          serviceId,
          notificationType: 'ended',
        }),
      );
    });

    it('should include all expected fields in SSE payload', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      const windowResult = createMaintenanceWindow({
        serviceId,
        title: 'Full payload test',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });
      expect(windowResult.ok).toBe(true);

      await checkMaintenanceWindows();

      expect(mockBroadcast).toHaveBeenCalledWith(
        'maintenance.started',
        expect.objectContaining({
          maintenanceWindowId: windowResult.data.id,
          serviceId,
          title: 'Full payload test',
          startAt: windowResult.data.startAt,
          endAt: windowResult.data.endAt,
          notificationType: 'started',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  // ── Scheduler Lifecycle ─────────────────────────────────────────────

  describe('scheduler lifecycle', () => {
    it('should start and stop without errors', () => {
      expect(() => startMaintenanceNotifier()).not.toThrow();

      // Starting again should warn but not throw
      expect(() => startMaintenanceNotifier()).not.toThrow();

      expect(() => stopMaintenanceNotifier()).not.toThrow();
    });

    it('should stop gracefully when not running', () => {
      stopMaintenanceNotifier(); // Already stopped
      expect(() => stopMaintenanceNotifier()).not.toThrow();
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle multiple windows in a single scan', async () => {
      const now = Date.now();
      const thirtyMin = 30 * 60 * 1000;
      const oneHour = 60 * 60 * 1000;
      const twoHours = 2 * 60 * 60 * 1000;

      // Upcoming window
      createMaintenanceWindow({
        serviceId,
        title: 'Upcoming',
        startAt: new Date(now + thirtyMin).toISOString(),
        endAt: new Date(now + twoHours).toISOString(),
      });

      // Active window
      createMaintenanceWindow({
        serviceId,
        title: 'Active',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });

      // Ended window
      createMaintenanceWindow({
        serviceId,
        title: 'Ended',
        startAt: new Date(now - twoHours).toISOString(),
        endAt: new Date(now - oneHour).toISOString(),
      });

      await checkMaintenanceWindows();

      // Should have broadcast 3 events: upcoming, started, ended
      expect(mockBroadcast).toHaveBeenCalledTimes(3);

      const eventTypes = mockBroadcast.mock.calls.map(
        (c: [string, unknown]) => c[0],
      );
      expect(eventTypes).toContain('maintenance.upcoming');
      expect(eventTypes).toContain('maintenance.started');
      expect(eventTypes).toContain('maintenance.ended');
    });

    it('should handle no maintenance windows gracefully', async () => {
      await expect(checkMaintenanceWindows()).resolves.not.toThrow();
      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('should not send notifications for future windows outside pre-notify range', async () => {
      const now = Date.now();
      const threeHours = 3 * 60 * 60 * 1000;
      const fourHours = 4 * 60 * 60 * 1000;

      createMaintenanceWindow({
        serviceId,
        title: 'Far future',
        startAt: new Date(now + threeHours).toISOString(),
        endAt: new Date(now + fourHours).toISOString(),
      });

      await checkMaintenanceWindows();

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('should handle notification tracking across separate windows', async () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      // Create second service
      const svc2Result = createService({
        name: 'Second Service',
        url: 'https://other.example.com/health',
      });
      expect(svc2Result.ok).toBe(true);

      const win1Result = createMaintenanceWindow({
        serviceId,
        title: 'Window for service 1',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });
      expect(win1Result.ok).toBe(true);

      const win2Result = createMaintenanceWindow({
        serviceId: svc2Result.data.id,
        title: 'Window for service 2',
        startAt: new Date(now - oneHour).toISOString(),
        endAt: new Date(now + oneHour).toISOString(),
      });
      expect(win2Result.ok).toBe(true);

      await checkMaintenanceWindows();

      // Both should have been notified
      expect(hasNotificationBeenSent(win1Result.data.id, 'started')).toBe(true);
      expect(hasNotificationBeenSent(win2Result.data.id, 'started')).toBe(true);

      // They should have separate notification records
      const notifs1 = getNotificationsForWindow(win1Result.data.id);
      const notifs2 = getNotificationsForWindow(win2Result.data.id);

      expect(notifs1.ok).toBe(true);
      expect(notifs2.ok).toBe(true);
      if (notifs1.ok && notifs2.ok) {
        expect(notifs1.data.length).toBe(1);
        expect(notifs2.data.length).toBe(1);
      }
    });
  });
});
