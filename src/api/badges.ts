/**
 * StatusOwl — Badge SVG Generator
 *
 * Generates shields.io-style SVG badges for service and overall status.
 * Badges are self-contained SVGs with a gray label on the left and
 * a colored status indicator on the right.
 */

import type { ServiceStatus } from '../core/index.js';

// ── Status color mapping ──

const STATUS_COLORS: Record<ServiceStatus, string> = {
  operational: '#4c1',
  degraded: '#dfb317',
  partial_outage: '#fe7d37',
  major_outage: '#e05d44',
  maintenance: '#007ec6',
  unknown: '#9f9f9f',
};

// ── Human-readable status text ──

const STATUS_TEXT: Record<ServiceStatus, string> = {
  operational: 'operational',
  degraded: 'degraded',
  partial_outage: 'partial outage',
  major_outage: 'major outage',
  maintenance: 'maintenance',
  unknown: 'unknown',
};

/**
 * Escape special XML characters to prevent SVG injection or malformed XML.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Estimate the rendered width of a text string in the badge font.
 * Uses a simplified character-width model based on Verdana 11px,
 * which is what shields.io badges use.
 */
function estimateTextWidth(text: string): number {
  // Average character width for Verdana 11px is approximately 6.8px
  // Narrower chars (i, l, t, f, r, 1) ~4px; wider chars (m, w, M, W) ~9px
  let width = 0;
  for (const ch of text) {
    if ('iltfr1|!.,;:\' '.includes(ch)) {
      width += 4.5;
    } else if ('mwMW'.includes(ch)) {
      width += 9;
    } else if (ch >= 'A' && ch <= 'Z') {
      width += 7.5;
    } else {
      width += 6.5;
    }
  }
  return width;
}

/**
 * Generate a shields.io-style SVG badge.
 *
 * @param label - Left side text (e.g. service name or "status")
 * @param status - The ServiceStatus enum value
 * @param statusText - Optional override for the right-side text (defaults to human-readable status)
 * @returns Valid SVG XML string
 */
export function generateBadgeSvg(
  label: string,
  status: ServiceStatus,
  statusText?: string,
): string {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  const message = statusText ?? STATUS_TEXT[status] ?? 'unknown';

  const escapedLabel = escapeXml(label);
  const escapedMessage = escapeXml(message);

  // Calculate widths with padding
  const labelWidth = Math.round(estimateTextWidth(label)) + 10;
  const messageWidth = Math.round(estimateTextWidth(message)) + 10;
  const totalWidth = labelWidth + messageWidth;

  // Text positioning (centered in each half)
  const labelX = labelWidth / 2;
  const messageX = labelWidth + messageWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${escapedLabel}: ${escapedMessage}">
  <title>${escapedLabel}: ${escapedMessage}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}">${escapedLabel}</text>
    <text x="${labelX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}">${escapedLabel}</text>
    <text aria-hidden="true" x="${messageX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}">${escapedMessage}</text>
    <text x="${messageX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(messageWidth - 10) * 10}">${escapedMessage}</text>
  </g>
</svg>`;
}

/**
 * Get the human-readable status text for a ServiceStatus value.
 */
export function getStatusText(status: ServiceStatus): string {
  return STATUS_TEXT[status] ?? 'unknown';
}

/**
 * Get the color associated with a ServiceStatus value.
 */
export function getStatusColor(status: ServiceStatus): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
}
