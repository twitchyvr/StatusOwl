/**
 * StatusOwl — Embeddable Status Widget
 *
 * Generates a self-contained HTML snippet with inline CSS and JS
 * suitable for embedding in third-party pages via an iframe or
 * direct HTML injection. No external dependencies required.
 */

import type { Service, ServiceStatus } from '../core/index.js';

// ── Status color mapping (matches badges.ts) ──

const STATUS_COLORS: Record<ServiceStatus, string> = {
  operational: '#4c1',
  degraded: '#dfb317',
  partial_outage: '#fe7d37',
  major_outage: '#e05d44',
  maintenance: '#007ec6',
  unknown: '#9f9f9f',
};

const STATUS_TEXT: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Maintenance',
  unknown: 'Unknown',
};

const OVERALL_STATUS_TEXT: Record<string, string> = {
  operational: 'All Systems Operational',
  degraded: 'Some Systems Degraded',
  partial_outage: 'Partial System Outage',
  major_outage: 'Major System Outage',
  maintenance: 'Under Maintenance',
  unknown: 'Status Unknown',
};

export interface WidgetConfig {
  /** Title displayed at the top of the widget */
  title?: string;
  /** Whether to show the overall status banner */
  showOverallStatus?: boolean;
  /** Custom CSS class prefix to avoid collisions */
  classPrefix?: string;
  /** Link to the full status page */
  statusPageUrl?: string;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate a self-contained HTML widget showing service statuses.
 *
 * @param services - Array of services with their current status
 * @param overallStatus - The computed overall system status
 * @param config - Optional widget configuration
 * @returns Complete HTML string with inline CSS and JS
 */
export function generateWidgetHtml(
  services: Array<Pick<Service, 'id' | 'name' | 'status'>>,
  overallStatus: ServiceStatus,
  config?: WidgetConfig,
): string {
  const title = escapeHtml(config?.title ?? 'System Status');
  const prefix = config?.classPrefix ?? 'so-widget';
  const showOverall = config?.showOverallStatus !== false;
  const statusPageUrl = config?.statusPageUrl;

  const overallColor = STATUS_COLORS[overallStatus] ?? STATUS_COLORS.unknown;
  const overallText = OVERALL_STATUS_TEXT[overallStatus] ?? 'Status Unknown';

  const serviceRows = services.map((svc) => {
    const color = STATUS_COLORS[svc.status] ?? STATUS_COLORS.unknown;
    const text = STATUS_TEXT[svc.status] ?? 'Unknown';
    const name = escapeHtml(svc.name);

    return `      <div class="${prefix}-service">
        <span class="${prefix}-service-name">${name}</span>
        <span class="${prefix}-status-dot" style="background-color: ${color};" title="${text}"></span>
        <span class="${prefix}-status-text" style="color: ${color};">${text}</span>
      </div>`;
  }).join('\n');

  const statusPageLink = statusPageUrl
    ? `\n      <a class="${prefix}-link" href="${escapeHtml(statusPageUrl)}" target="_blank" rel="noopener noreferrer">View Status Page</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  .${prefix} {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 400px;
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    color: #24292f;
    font-size: 14px;
    line-height: 1.5;
  }
  .${prefix}-header {
    padding: 12px 16px;
    font-weight: 600;
    font-size: 16px;
    border-bottom: 1px solid #e1e4e8;
    background: #f6f8fa;
  }
  .${prefix}-overall {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    font-weight: 500;
    border-bottom: 1px solid #e1e4e8;
  }
  .${prefix}-overall-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .${prefix}-services {
    padding: 4px 0;
  }
  .${prefix}-service {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
  }
  .${prefix}-service:hover {
    background: #f6f8fa;
  }
  .${prefix}-service-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .${prefix}-status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .${prefix}-status-text {
    font-size: 12px;
    font-weight: 500;
    min-width: 90px;
    text-align: right;
  }
  .${prefix}-footer {
    padding: 8px 16px;
    border-top: 1px solid #e1e4e8;
    background: #f6f8fa;
    font-size: 12px;
    color: #57606a;
    text-align: center;
  }
  .${prefix}-link {
    color: #0969da;
    text-decoration: none;
  }
  .${prefix}-link:hover {
    text-decoration: underline;
  }
  .${prefix}-empty {
    padding: 16px;
    text-align: center;
    color: #57606a;
  }
</style>
</head>
<body>
  <div class="${prefix}">
    <div class="${prefix}-header">${title}</div>
${showOverall ? `    <div class="${prefix}-overall">
      <span class="${prefix}-overall-dot" style="background-color: ${overallColor};"></span>
      <span>${escapeHtml(overallText)}</span>
    </div>
` : ''}    <div class="${prefix}-services">
${services.length > 0 ? serviceRows : `      <div class="${prefix}-empty">No services configured</div>`}
    </div>
    <div class="${prefix}-footer">
      Powered by StatusOwl${statusPageLink}
    </div>
  </div>
</body>
</html>`;
}
