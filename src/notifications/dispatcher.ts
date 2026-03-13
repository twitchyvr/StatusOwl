/**
 * StatusOwl — Notification Dispatcher
 *
 * Dispatches incident notifications to all configured channels:
 * - Webhooks (existing)
 * - Slack
 * - Discord
 * - Email (SMTP)
 */

import { createHmac } from 'node:crypto';
import { getConfig, createChildLogger } from '../core/index.js';
import type { Incident, Service, WebhookEventType } from '../core/index.js';
import { getServicesByIds } from '../storage/index.js';
import { sendSlackNotification } from './slack.js';
import { sendDiscordNotification } from './discord.js';
import { sendEmailNotification } from './email.js';
import { getWebhooksByEvent } from './webhook-repo.js';

const log = createChildLogger('NotificationDispatcher');

export type IncidentEvent = 'created' | 'resolved' | 'updated';

/**
 * Dispatch incident notifications to all configured channels.
 * 
 * @param incident - The incident to notify about
 * @param event - The type of event (created, resolved, updated)
 */
export async function notifyIncident(
  incident: Incident,
  event: IncidentEvent
): Promise<void> {
  const config = getConfig();

  // Get affected services
  let services: Service[] = [];
  if (incident.serviceIds.length > 0) {
    const servicesResult = getServicesByIds(incident.serviceIds);
    if (servicesResult.ok) {
      services = servicesResult.data;
    }
  }

  log.info(
    { incidentId: incident.id, event, services: services.map(s => s.name) },
    'Dispatching incident notifications'
  );

  // Collect all notification promises
  const notifications: Array<Promise<void>> = [];

  // 1. Send to Slack if configured
  if (config.slackWebhook) {
    notifications.push(
      sendSlackNotification(incident, services, event).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ incidentId: incident.id, channel: 'slack', error: msg }, 'Slack notification failed');
      })
    );
  }

  // 2. Send to registered webhooks
  const webhookEvent = mapIncidentEventToWebhookEvent(incident, event);
  if (webhookEvent) {
    const webhooksResult = getWebhooksByEvent(webhookEvent);
    if (webhooksResult.ok) {
      for (const webhook of webhooksResult.data) {
        notifications.push(
          deliverWebhook(webhook.url, webhook.secret, {
            event: webhookEvent,
            incident,
            services,
            timestamp: new Date().toISOString(),
          }).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            log.error({ incidentId: incident.id, channel: 'webhook', webhookUrl: webhook.url, error: msg }, 'Webhook delivery failed');
          })
        );
      }
    }
  }

  // 3. Send to Discord if configured
  if (config.discordWebhook) {
    notifications.push(
      sendDiscordNotification(incident, services, event).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ incidentId: incident.id, channel: 'discord', error: msg }, 'Discord notification failed');
      })
    );
  }

  // 4. Send email if configured
  if (config.smtpHost && config.emailFrom && config.emailTo) {
    notifications.push(
      sendEmailNotification(incident, services, event).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ incidentId: incident.id, channel: 'email', error: msg }, 'Email notification failed');
      })
    );
  }

  // Wait for all notifications to complete
  await Promise.allSettled(notifications);

  log.info({ incidentId: incident.id, event }, 'Incident notifications dispatched');
}

/**
 * Map an IncidentEvent to the corresponding WebhookEventType.
 */
function mapIncidentEventToWebhookEvent(
  incident: Incident,
  event: IncidentEvent
): WebhookEventType | null {
  switch (event) {
    case 'created':
      return 'incident.created';
    case 'resolved':
      return 'incident.resolved';
    case 'updated':
      return 'incident.updated';
    default:
      return null;
  }
}

/**
 * Deliver a webhook payload to a subscriber URL.
 * Includes HMAC-SHA256 signature in X-StatusOwl-Signature header if secret is configured.
 */
async function deliverWebhook(
  url: string,
  secret: string | undefined,
  payload: Record<string, unknown>
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'StatusOwl/1.0',
  };

  if (secret) {
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    headers['X-StatusOwl-Signature'] = `sha256=${signature}`;
  }

  const config = getConfig();
  const maxRetries = config.webhookRetries ?? 3;
  const backoffMs = config.webhookBackoffMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        log.debug({ url, status: response.status }, 'Webhook delivered');
        return;
      }

      // Non-retryable client errors (4xx except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        log.warn({ url, status: response.status }, 'Webhook rejected by receiver (non-retryable)');
        return;
      }

      log.warn({ url, status: response.status, attempt }, 'Webhook delivery failed, retrying');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ url, error: msg, attempt }, 'Webhook delivery error, retrying');
    }

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
    }
  }

  log.error({ url, maxRetries }, 'Webhook delivery failed after all retries');
}
