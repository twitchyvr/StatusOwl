/**
 * StatusOwl — Email Notification Channel
 *
 * Sends incident notifications via SMTP email with HTML templates.
 */

import nodemailer from 'nodemailer';
import { getConfig, createChildLogger } from '../core/index.js';
import type { Incident, Service } from '../core/index.js';
import type { IncidentEvent } from './dispatcher.js';

const log = createChildLogger('EmailNotification');

/**
 * Format incident as HTML email.
 */
export function formatEmailHtml(
  incident: Incident,
  services: Service[],
  event: IncidentEvent
): string {
  const severityColors: Record<string, string> = {
    critical: '#dc2626',
    major: '#ea580c',
    minor: '#ca8a04',
  };

  const statusLabels: Record<string, string> = {
    investigating: 'Investigating',
    identified: 'Identified',
    monitoring: 'Monitoring',
    resolved: 'Resolved',
  };

  const eventLabels: Record<string, string> = {
    created: 'New Incident',
    updated: 'Incident Updated',
    resolved: 'Incident Resolved',
  };

  const color = severityColors[incident.severity] ?? '#6b7280';
  const serviceNames = services.map(s => s.name).join(', ') || 'Unknown';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: ${color}; padding: 16px 24px;">
      <h1 style="color: #ffffff; margin: 0; font-size: 18px;">
        ${eventLabels[event] ?? event} — ${incident.severity.toUpperCase()}
      </h1>
    </div>
    <div style="padding: 24px;">
      <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #111827;">${escapeHtml(incident.title)}</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Status</td>
          <td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${statusLabels[incident.status] ?? incident.status}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Severity</td>
          <td style="padding: 8px 0; font-size: 14px;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: ${color}; color: white; font-size: 12px; font-weight: 600;">
              ${incident.severity.toUpperCase()}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Affected Services</td>
          <td style="padding: 8px 0; font-size: 14px;">${escapeHtml(serviceNames)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Time</td>
          <td style="padding: 8px 0; font-size: 14px;">${new Date().toISOString()}</td>
        </tr>
      </table>
      ${incident.message ? `<div style="padding: 12px; background: #f9fafb; border-radius: 6px; font-size: 14px; color: #374151;">${escapeHtml(incident.message)}</div>` : ''}
    </div>
    <div style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
      Sent by StatusOwl
    </div>
  </div>
</body>
</html>`;
}

/**
 * Format a plain text version of the email.
 */
export function formatEmailText(
  incident: Incident,
  services: Service[],
  event: IncidentEvent
): string {
  const serviceNames = services.map(s => s.name).join(', ') || 'Unknown';
  const eventLabel = event === 'created' ? 'NEW INCIDENT' : event === 'resolved' ? 'RESOLVED' : 'UPDATED';

  return [
    `[${eventLabel}] ${incident.title}`,
    '',
    `Severity: ${incident.severity.toUpperCase()}`,
    `Status: ${incident.status}`,
    `Affected: ${serviceNames}`,
    `Time: ${new Date().toISOString()}`,
    '',
    incident.message ? `Message: ${incident.message}` : '',
    '',
    '— StatusOwl',
  ].filter(Boolean).join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send email notification for an incident.
 */
export async function sendEmailNotification(
  incident: Incident,
  services: Service[],
  event: IncidentEvent
): Promise<void> {
  const config = getConfig();

  if (!config.smtpHost || !config.emailFrom || !config.emailTo) {
    log.debug('Email not configured, skipping');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? {
      user: config.smtpUser,
      pass: config.smtpPass,
    } : undefined,
  });

  const recipients = config.emailTo.split(',').map(e => e.trim()).filter(Boolean);

  const eventLabel = event === 'created' ? 'New Incident' : event === 'resolved' ? 'Resolved' : 'Updated';
  const subject = `[StatusOwl] ${eventLabel}: ${incident.title}`;

  const html = formatEmailHtml(incident, services, event);
  const text = formatEmailText(incident, services, event);

  try {
    await transporter.sendMail({
      from: config.emailFrom,
      to: recipients.join(', '),
      subject,
      text,
      html,
    });

    log.info({ incidentId: incident.id, recipients: recipients.length }, 'Email notification sent');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ incidentId: incident.id, error: msg }, 'Failed to send email notification');
    throw e;
  }
}
