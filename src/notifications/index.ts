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
