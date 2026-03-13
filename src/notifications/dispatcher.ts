/**
 * StatusOwl — Notification Dispatcher
 *
 * Dispatches incident notifications to all configured channels:
 * - Webhooks (existing)
 * - Slack
 * - Discord
 */

import { getConfig, createChildLogger } from '../core/index.js';
import type { Incident, Service } from '../core/index.js';
import { getServicesByIds } from '../storage/index.js';
import { sendSlackNotification } from './slack.js';
import { sendDiscordNotification } from './discord.js';

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

  // 3. Send to Discord if configured
  if (config.discordWebhook) {
    notifications.push(
      sendDiscordNotification(incident, services, event).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.error({ incidentId: incident.id, channel: 'discord', error: msg }, 'Discord notification failed');
      })
    );
  }

  // Wait for all notifications to complete
  await Promise.allSettled(notifications);

  log.info({ incidentId: incident.id, event }, 'Incident notifications dispatched');
}
