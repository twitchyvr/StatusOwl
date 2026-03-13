/**
 * StatusOwl — Webhook Dispatcher
 *
 * Sends webhook notifications to subscribed endpoints.
 */

import { createHmac } from 'node:crypto';
import { getWebhooksByEvent } from './webhook-repo.js';
import { createChildLogger } from '../core/index.js';
import type { WebhookEventType } from '../core/index.js';

const log = createChildLogger('WebhookDispatcher');

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Dispatch an event to all subscribed webhooks.
 */
export async function dispatchEvent(
  event: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const webhooksResult = getWebhooksByEvent(event);

  if (!webhooksResult.ok) {
    log.error({ event, error: webhooksResult.error.message }, 'Failed to get webhooks for event');
    return;
  }

  const webhooks = webhooksResult.data;

  if (webhooks.length === 0) {
    log.debug({ event }, 'No webhooks subscribed to event');
    return;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const payloadStr = JSON.stringify(payload);

  // Send to all webhooks in parallel
  const promises = webhooks.map((webhook) => sendWebhook(webhook.url, webhook.secret, payloadStr));
  const results = await Promise.allSettled(promises);

  // Log results
  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  const failCount = results.filter((r) => r.status === 'rejected').length;

  log.info({ event, successCount, failCount, total: webhooks.length }, 'Webhook dispatch completed');

  // Log any failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const webhook = webhooks[index];
      log.error({ url: webhook.url, error: result.reason }, 'Failed to deliver webhook');
    }
  });
}

/**
 * Send a webhook to a single URL.
 */
async function sendWebhook(url: string, secret: string | undefined, payload: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add HMAC signature if secret is provided
  if (secret) {
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    headers['X-StatusOwl-Signature'] = `sha256=${signature}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: payload,
    // Timeout after 10 seconds
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}
