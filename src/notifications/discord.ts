/**
 * StatusOwl — Discord Notifications
 *
 * Sends incident notifications to Discord via webhook.
 * Uses Discord Embeds for rich message formatting.
 */

import { getConfig, createChildLogger } from '../core/index.js';
import type { Incident, IncidentSeverity, Service } from '../core/index.js';

const log = createChildLogger('DiscordNotifier');

// Discord API colors for different severity levels (as decimal)
const SEVERITY_COLORS: Record<IncidentSeverity, number> = {
  minor: 0xFFFF00,    // yellow
  major: 0xFFA500,    // orange
  critical: 0xFF0000, // red
};

// Status color for resolved incidents
const RESOLVED_COLOR = 0x00FF00; // green

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

/**
 * Format an incident as a Discord embed.
 */
export function formatDiscordEmbed(
  incident: Incident,
  services: Service[],
  event: 'created' | 'resolved' | 'updated'
): DiscordEmbed {
  const color = event === 'resolved' ? RESOLVED_COLOR : SEVERITY_COLORS[incident.severity];

  const statusText = event === 'created'
    ? '🔴 INCIDENT CREATED'
    : event === 'resolved'
      ? '✅ INCIDENT RESOLVED'
      : '🟡 INCIDENT UPDATED';

  const severityText = incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1);

  const affectedServiceNames = services.length > 0
    ? services.map((s) => `• ${s.name}`).join('\n')
    : 'No services affected';

  const embed: DiscordEmbed = {
    title: `${statusText}: ${incident.title}`,
    color,
    fields: [
      {
        name: 'Severity',
        value: severityText,
        inline: true,
      },
      {
        name: 'Status',
        value: incident.status.replace('_', ' '),
        inline: true,
      },
      {
        name: 'Affected Services',
        value: affectedServiceNames,
        inline: false,
      },
    ],
    footer: {
      text: `Incident ID: ${incident.id}`,
    },
    timestamp: new Date().toISOString(),
  };

  // Add message/description if present
  if (incident.message) {
    embed.description = incident.message;
  }

  return embed;
}

/**
 * Send a Discord notification for an incident.
 */
export async function sendDiscordNotification(
  incident: Incident,
  services: Service[],
  event: 'created' | 'resolved' | 'updated'
): Promise<void> {
  const config = getConfig();

  if (!config.discordWebhook) {
    log.debug('Discord webhook not configured, skipping notification');
    return;
  }

  const embed = formatDiscordEmbed(incident, services, event);

  const payload = {
    username: 'StatusOwl',
    avatar_url: 'https://statusowl.com/logo.png',
    embeds: [embed],
  };

  try {
    const response = await fetch(config.discordWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    log.info({ incidentId: incident.id, event }, 'Discord notification sent');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ incidentId: incident.id, error: msg }, 'Failed to send Discord notification');
    throw e;
  }
}
