/**
 * StatusOwl — Notifications Module
 *
 * Barrel export for webhook notifications.
 */

export {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  getWebhookById,
  getWebhooksByEvent,
} from './webhook-repo.js';

export {
  dispatchEvent,
} from './dispatcher.js';

export type { WebhookPayload } from './dispatcher.js';
