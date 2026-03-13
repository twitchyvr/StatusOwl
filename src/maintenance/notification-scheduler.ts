/**
 * StatusOwl — Maintenance Notification Scheduler
 *
 * Scans for upcoming, starting, and ending maintenance windows at regular
 * intervals and dispatches notifications through all configured channels:
 * webhooks, email subscribers, and SSE broadcasts.
 *
 * Tracks sent notifications in the `maintenance_notifications` DB table
 * to prevent duplicate sends across scheduler cycles.
 */

import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { createChildLogger, ok, err, getConfig } from '../core/index.js';
import type { Result, MaintenanceWindow } from '../core/index.js';
import { getDb } from '../storage/database.js';
import { listMaintenanceWindows } from './maintenance-repo.js';
import { getWebhooksByEvent } from '../notifications/webhook-repo.js';
import { listSubscriptions } from '../subscriptions/subscription-repo.js';
import { getEventBus } from '../api/event-stream.js';
import type { SseEventType } from '../api/event-stream.js';

const log = createChildLogger('MaintenanceNotify');

/** How often the scheduler scans for windows (ms). */
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** How far before a window starts to send the "upcoming" notification (ms). */
const PRE_NOTIFY_MS = 60 * 60 * 1000; // 1 hour

/** Notification types tracked in the database. */
type NotificationType = 'upcoming' | 'started' | 'ended';

/** A record from the maintenance_notifications table. */
interface NotificationRecord {
  id: string;
  maintenanceWindowId: string;
  notificationType: NotificationType;
  sentAt: string;
}

/** Timer handle for the running scheduler. */
let _timer: ReturnType<typeof setInterval> | null = null;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Start the periodic maintenance notification scanner.
 * Runs an immediate check, then repeats every 5 minutes.
 */
export function startMaintenanceNotifier(): void {
  if (_timer) {
    log.warn('Maintenance notifier already running');
    return;
  }

  log.info('Starting maintenance notification scheduler');

  // Run immediately, then on interval
  void checkMaintenanceWindows();

  _timer = setInterval(() => {
    void checkMaintenanceWindows();
  }, SCAN_INTERVAL_MS);

  // Allow the process to exit without waiting for this timer
  if (_timer.unref) {
    _timer.unref();
  }
}

/**
 * Stop the maintenance notification scheduler.
 */
export function stopMaintenanceNotifier(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log.info('Maintenance notification scheduler stopped');
  }
}

/**
 * Perform a single scan of all maintenance windows and send any
 * pending notifications. This is the core logic invoked by the
 * scheduler interval, and is also exported for testing.
 */
export async function checkMaintenanceWindows(): Promise<void> {
  try {
    const windowsResult = listMaintenanceWindows();
    if (!windowsResult.ok) {
      log.error({ error: windowsResult.error }, 'Failed to list maintenance windows');
      return;
    }

    const now = new Date();

    for (const window of windowsResult.data) {
      const startAt = new Date(window.startAt);
      const endAt = new Date(window.endAt);
      const msUntilStart = startAt.getTime() - now.getTime();
      const msUntilEnd = endAt.getTime() - now.getTime();

      // 1. Upcoming: within pre-notify window but hasn't started yet
      if (msUntilStart > 0 && msUntilStart <= PRE_NOTIFY_MS) {
        await sendNotificationIfNeeded(window, 'upcoming');
      }

      // 2. Started: start time has passed but end time hasn't
      if (msUntilStart <= 0 && msUntilEnd > 0) {
        await sendNotificationIfNeeded(window, 'started');
      }

      // 3. Ended: end time has passed
      if (msUntilEnd <= 0) {
        await sendNotificationIfNeeded(window, 'ended');
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Maintenance window check failed');
  }
}

// ── Notification State Tracking ─────────────────────────────────────────

/**
 * Check whether a notification has already been sent for a given
 * window + type combination.
 */
export function hasNotificationBeenSent(
  windowId: string,
  type: NotificationType,
): boolean {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT 1 FROM maintenance_notifications WHERE maintenance_window_id = ? AND notification_type = ?',
    ).get(windowId, type);
    return row !== undefined;
  } catch {
    return false;
  }
}

/**
 * Record that a notification was sent, preventing future duplicates.
 */
export function recordNotificationSent(
  windowId: string,
  type: NotificationType,
): Result<NotificationRecord> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO maintenance_notifications (id, maintenance_window_id, notification_type, sent_at)
      VALUES (?, ?, ?, ?)
    `).run(id, windowId, type, now);

    log.info({ windowId, type }, 'Notification recorded');
    return ok({ id, maintenanceWindowId: windowId, notificationType: type, sentAt: now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Duplicate constraint means it was already sent — not an error
    if (msg.includes('UNIQUE constraint')) {
      return err('DUPLICATE', 'Notification already sent');
    }
    log.error({ error: msg, windowId, type }, 'Failed to record notification');
    return err('DB_ERROR', msg);
  }
}

/**
 * Get all notification records for a maintenance window.
 */
export function getNotificationsForWindow(
  windowId: string,
): Result<NotificationRecord[]> {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM maintenance_notifications WHERE maintenance_window_id = ? ORDER BY sent_at',
    ).all(windowId) as Record<string, unknown>[];

    return ok(rows.map(rowToNotificationRecord));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('DB_ERROR', msg);
  }
}

// ── Internal Dispatch Logic ─────────────────────────────────────────────

/**
 * Send a notification for a maintenance window if it hasn't been sent yet.
 * Records the send in the DB to prevent duplicates.
 */
async function sendNotificationIfNeeded(
  window: MaintenanceWindow,
  type: NotificationType,
): Promise<void> {
  if (hasNotificationBeenSent(window.id, type)) {
    return;
  }

  log.info(
    { windowId: window.id, title: window.title, type },
    'Sending maintenance notification',
  );

  // Record first (if another cycle fires before dispatch completes, it won't double-send)
  const recordResult = recordNotificationSent(window.id, type);
  if (!recordResult.ok) {
    // DUPLICATE is fine — another cycle beat us to it
    if (recordResult.error.code === 'DUPLICATE') return;
    log.error({ error: recordResult.error }, 'Failed to record notification — skipping dispatch');
    return;
  }

  const payload = buildPayload(window, type);

  // Dispatch in parallel: SSE, webhooks, email subscribers
  const dispatches: Array<Promise<void>> = [];

  // 1. SSE broadcast
  dispatches.push(broadcastSse(type, payload));

  // 2. Webhooks
  dispatches.push(dispatchWebhooks(type, payload));

  // 3. Email subscribers (log intent — actual email sending depends on SMTP config)
  dispatches.push(notifySubscribers(window, type));

  await Promise.allSettled(dispatches);

  log.info({ windowId: window.id, type }, 'Maintenance notification dispatched');
}

/**
 * Build the notification payload for a maintenance window event.
 */
function buildPayload(
  window: MaintenanceWindow,
  type: NotificationType,
): Record<string, unknown> {
  return {
    maintenanceWindowId: window.id,
    serviceId: window.serviceId,
    title: window.title,
    startAt: window.startAt,
    endAt: window.endAt,
    notificationType: type,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Map a maintenance notification type to the corresponding SSE event type.
 */
function mapToSseEvent(type: NotificationType): SseEventType {
  switch (type) {
    case 'upcoming':
      return 'maintenance.upcoming';
    case 'started':
      return 'maintenance.started';
    case 'ended':
      return 'maintenance.ended';
  }
}

/**
 * Broadcast a maintenance event via SSE to all connected clients.
 */
async function broadcastSse(
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const eventBus = getEventBus();
    const sseEvent = mapToSseEvent(type);
    eventBus.broadcast(sseEvent, payload);
    log.debug({ type, sseEvent }, 'SSE maintenance event broadcast');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, type }, 'Failed to broadcast SSE maintenance event');
  }
}

/**
 * Dispatch maintenance notifications to all enabled webhooks that
 * subscribe to the relevant event type. Uses the same delivery
 * mechanism as incident notifications.
 */
async function dispatchWebhooks(
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    // Map to webhook event types — maintenance events use the SSE event names
    const eventName = mapToSseEvent(type);

    // Get webhooks — currently the webhook event schema is limited to incident/service events,
    // so we dispatch to all enabled webhooks for maintenance events
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM webhooks WHERE enabled = 1',
    ).all() as Record<string, unknown>[];

    if (rows.length === 0) {
      log.debug('No enabled webhooks for maintenance notification');
      return;
    }

    const config = getConfig();

    for (const row of rows) {
      const url = row.url as string;
      const secret = row.secret as string | undefined;

      try {
        const body = JSON.stringify({ event: eventName, ...payload });
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'StatusOwl/1.0',
        };

        if (secret) {
          const signature = createHmac('sha256', secret).update(body).digest('hex');
          headers['X-StatusOwl-Signature'] = `sha256=${signature}`;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) {
          log.debug({ url, status: response.status }, 'Maintenance webhook delivered');
        } else {
          log.warn({ url, status: response.status }, 'Maintenance webhook delivery failed');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ url, error: msg }, 'Maintenance webhook delivery error');
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to dispatch maintenance webhooks');
  }
}

/**
 * Notify email subscribers about a maintenance window event.
 * Logs the notification intent — actual email delivery depends on
 * SMTP configuration being present.
 */
async function notifySubscribers(
  window: MaintenanceWindow,
  type: NotificationType,
): Promise<void> {
  try {
    const subsResult = listSubscriptions();
    if (!subsResult.ok) {
      log.error({ error: subsResult.error }, 'Failed to list subscriptions for maintenance notify');
      return;
    }

    const confirmed = subsResult.data.filter((s) => s.confirmed);
    if (confirmed.length === 0) {
      log.debug('No confirmed subscribers for maintenance notification');
      return;
    }

    const config = getConfig();
    if (!config.smtpHost || !config.emailFrom) {
      log.debug({ subscriberCount: confirmed.length }, 'SMTP not configured — skipping email notifications');
      return;
    }

    // Import nodemailer dynamically to avoid issues when SMTP isn't configured
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    });

    const typeLabels: Record<NotificationType, string> = {
      upcoming: 'Upcoming Maintenance',
      started: 'Maintenance Started',
      ended: 'Maintenance Completed',
    };

    const subject = `[StatusOwl] ${typeLabels[type]}: ${window.title}`;
    const text = formatMaintenanceEmailText(window, type);
    const html = formatMaintenanceEmailHtml(window, type);

    // Send to each confirmed subscriber (filter by service if they are service-specific)
    for (const sub of confirmed) {
      // If subscriber is service-specific, only notify about that service
      if (sub.serviceId && sub.serviceId !== window.serviceId) {
        continue;
      }

      try {
        await transporter.sendMail({
          from: config.emailFrom,
          to: sub.email,
          subject,
          text,
          html,
        });
        log.debug({ email: sub.email, type }, 'Maintenance email sent');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ email: sub.email, error: msg }, 'Failed to send maintenance email');
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to notify subscribers about maintenance');
  }
}

// ── Email Formatting ────────────────────────────────────────────────────

function formatMaintenanceEmailText(
  window: MaintenanceWindow,
  type: NotificationType,
): string {
  const typeLabels: Record<NotificationType, string> = {
    upcoming: 'UPCOMING MAINTENANCE',
    started: 'MAINTENANCE STARTED',
    ended: 'MAINTENANCE COMPLETED',
  };

  return [
    `[${typeLabels[type]}] ${window.title}`,
    '',
    `Service: ${window.serviceId}`,
    `Start: ${window.startAt}`,
    `End: ${window.endAt}`,
    `Time: ${new Date().toISOString()}`,
    '',
    '-- StatusOwl',
  ].join('\n');
}

function formatMaintenanceEmailHtml(
  window: MaintenanceWindow,
  type: NotificationType,
): string {
  const colors: Record<NotificationType, string> = {
    upcoming: '#ca8a04',
    started: '#ea580c',
    ended: '#16a34a',
  };

  const typeLabels: Record<NotificationType, string> = {
    upcoming: 'Upcoming Maintenance',
    started: 'Maintenance Started',
    ended: 'Maintenance Completed',
  };

  const color = colors[type];

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${color};padding:16px 24px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">${typeLabels[type]}</h1>
    </div>
    <div style="padding:24px;">
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827;">${escapeHtml(window.title)}</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;">Window Start</td>
          <td style="padding:8px 0;font-size:14px;">${window.startAt}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;">Window End</td>
          <td style="padding:8px 0;font-size:14px;">${window.endAt}</td>
        </tr>
      </table>
    </div>
    <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
      Sent by StatusOwl
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Helpers ─────────────────────────────────────────────────────────────

function rowToNotificationRecord(row: Record<string, unknown>): NotificationRecord {
  return {
    id: row.id as string,
    maintenanceWindowId: row.maintenance_window_id as string,
    notificationType: row.notification_type as NotificationType,
    sentAt: row.sent_at as string,
  };
}
