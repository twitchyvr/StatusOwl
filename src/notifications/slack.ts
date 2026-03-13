/**
 * StatusOwl — Slack Notifications
 *
 * Sends incident notifications to Slack via webhook.
 * Uses Slack Block Kit for rich message formatting.
 */

import { getConfig, createChildLogger } from '../core/index.js';
import type { Incident, IncidentSeverity, Service } from '../core/index.js';

const log = createChildLogger('SlackNotifier');

// Slack API colors for different severity levels
const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  minor: '#FFFF00',    // yellow
  major: '#FFA500',    // orange
  critical: '#FF0000', // red
};

// Status colors for resolved incidents
const RESOLVED_COLOR = '#00FF00'; // green

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  color?: string;
}

/**
 * Format an incident as a Slack message using Block Kit.
 */
export function formatSlackMessage(
  incident: Incident,
  services: Service[],
  event: 'created' | 'resolved' | 'updated'
): { payload: string } {
  const color = event === 'resolved' ? RESOLVED_COLOR : SEVERITY_COLORS[incident.severity];

  const statusText = event === 'created'
    ? '🔴 *INCIDENT CREATED*'
    : event === 'resolved'
      ? '✅ *INCIDENT RESOLVED*'
      : '🟡 *INCIDENT UPDATED*';

  const severityText = incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1);

  const affectedServiceNames = services.length > 0
    ? services.map((s) => `• ${s.name}`).join('\n')
    : 'No services affected';

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusText}\n*${incident.title}*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Severity:*\n${severityText}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${incident.status.replace('_', ' ')}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Affected Services:*\n${affectedServiceNames}`,
      },
    },
  ];

  // Add message if present
  if (incident.message) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Details:*\n${incident.message}`,
      },
    });
  }

  // Add timestamp
  blocks.push({
    type: 'context',
    text: {
      type: 'mrkdwn',
      text: `Incident ID: ${incident.id} | Created: ${incident.createdAt ?? 'N/A'}`,
    },
  });

  return {
    payload: JSON.stringify({
      blocks,
      attachments: [
        {
          color,
          blocks,
        },
      ],
    }),
  };
}

/**
 * Send a Slack notification for an incident.
 */
export async function sendSlackNotification(
  incident: Incident,
  services: Service[],
  event: 'created' | 'resolved' | 'updated'
): Promise<void> {
  const config = getConfig();

  if (!config.slackWebhook) {
    log.debug('Slack webhook not configured, skipping notification');
    return;
  }

  const { payload } = formatSlackMessage(incident, services, event);

  try {
    const response = await fetch(config.slackWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    log.info({ incidentId: incident.id, event }, 'Slack notification sent');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ incidentId: incident.id, error: msg }, 'Failed to send Slack notification');
    throw e;
  }
}
