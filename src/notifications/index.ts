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
  notifyIncident,
} from './dispatcher.js';

export type { IncidentEvent } from './dispatcher.js';

export {
  sendSlackNotification,
  formatSlackMessage,
} from './slack.js';

export {
  sendDiscordNotification,
  formatDiscordEmbed,
} from './discord.js';

export {
  sendEmailNotification,
  formatEmailHtml,
  formatEmailText,
} from './email.js';

export {
  recordDelivery,
  markDeliverySuccess,
  markDeliveryFailed,
  moveToDeadLetter,
  getDeliveryHistory,
  getPendingRetries,
  retryDelivery,
  getDeadLetters,
  calculateNextRetry,
} from './webhook-delivery.js';

export type {
  DeliveryStatus,
  WebhookDelivery,
  WebhookDeadLetter,
} from './webhook-delivery.js';
