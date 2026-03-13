/**
 * Badge & Embed Widget Tests
 *
 * Tests SVG badge generation, widget HTML generation, and the
 * corresponding API endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Mocks (declared before importing module under test) ──

vi.mock('../src/storage/index.js', () => ({
  createService: vi.fn(),
  getService: vi.fn(),
  listServices: vi.fn(),
  listServicesPaginated: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  getRecentChecks: vi.fn(),
  getUptimeSummary: vi.fn(),
  getDailyHistory: vi.fn(),
  getLatestSslCheck: vi.fn(),
  getSslHistory: vi.fn(),
  createGroup: vi.fn(),
  getGroup: vi.fn(),
  listGroups: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  getDependenciesOf: vi.fn(),
  getDependentsOn: vi.fn(),
  getDownstreamServices: vi.fn(),
}));

vi.mock('../src/monitors/index.js', () => ({
  scheduleService: vi.fn(),
  unscheduleService: vi.fn(),
}));

vi.mock('../src/incidents/index.js', () => ({
  getOpenIncidents: vi.fn(),
  getIncidentById: vi.fn(),
  getIncidentsByService: vi.fn(),
  updateIncidentStatus: vi.fn(),
}));

vi.mock('../src/storage/database.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => ({ count: 0 })),
    })),
  })),
  closeDb: vi.fn(),
}));

vi.mock('../src/monitors/percentile-aggregator.js', () => ({
  getPercentiles: vi.fn(),
}));

vi.mock('../src/maintenance/index.js', () => ({
  createMaintenanceWindow: vi.fn(),
  getMaintenanceWindow: vi.fn(),
  listMaintenanceWindows: vi.fn(),
  deleteMaintenanceWindow: vi.fn(),
}));

vi.mock('../src/alerts/index.js', () => ({
  createAlertPolicy: vi.fn(),
  getAlertPolicy: vi.fn(),
  getAlertPolicyByService: vi.fn(),
  listAlertPolicies: vi.fn(),
  updateAlertPolicy: vi.fn(),
  deleteAlertPolicy: vi.fn(),
}));

vi.mock('../src/auth/index.js', () => ({
  registerClient: vi.fn(),
  requestGrant: vi.fn(),
  introspectToken: vi.fn(),
  revokeToken: vi.fn(),
  rotateToken: vi.fn(),
}));

vi.mock('../src/audit/index.js', () => ({
  recordAudit: vi.fn(),
  queryAuditLog: vi.fn(),
}));

vi.mock('../src/subscriptions/index.js', () => ({
  createSubscription: vi.fn(),
  confirmSubscription: vi.fn(),
  unsubscribe: vi.fn(),
  listSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
}));

vi.mock('../src/reports/index.js', () => ({
  generateReport: vi.fn(),
  getReport: vi.fn(),
  listReports: vi.fn(),
}));

vi.mock('../src/api/auth.js', () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../src/api/calendar.js', () => ({
  getCalendarData: vi.fn(),
  getOverallCalendarData: vi.fn(),
}));

vi.mock('../src/api/event-stream.js', () => ({
  getEventBus: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getConnectionCount: vi.fn(() => 0),
    getEventsSince: vi.fn(() => []),
  })),
}));

vi.mock('../src/monitors/region-repo.js', () => ({
  createRegion: vi.fn(),
  listRegions: vi.fn(),
  getRegion: vi.fn(),
  deleteRegion: vi.fn(),
  getRegionalLatency: vi.fn(),
}));

vi.mock('../src/notifications/webhook-delivery.js', () => ({
  getDeliveryHistory: vi.fn(),
  retryDelivery: vi.fn(),
}));

vi.mock('../src/notifications/webhook-repo.js', () => ({
  getWebhookById: vi.fn(),
}));

vi.mock('../src/sla/index.js', () => ({
  createSlaTarget: vi.fn(),
  getSlaTarget: vi.fn(),
  listSlaTargets: vi.fn(),
  updateSlaTarget: vi.fn(),
  deleteSlaTarget: vi.fn(),
  calculateHealthScore: vi.fn(),
  calculateSlaCompliance: vi.fn(),
}));

import { router } from '../src/api/routes.js';
import { getService, listServices } from '../src/storage/index.js';
import { generateBadgeSvg, getStatusText, getStatusColor } from '../src/api/badges.js';
import { generateWidgetHtml } from '../src/api/embed-widget.js';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function fakeService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    name: 'API Gateway',
    url: 'https://api.example.com/health',
    method: 'GET',
    expectedStatus: 200,
    checkInterval: 60,
    timeout: 10,
    status: 'operational',
    enabled: true,
    groupId: null,
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Unit Tests: Badge SVG Generation ──

describe('Badge SVG Generation', () => {
  it('generates valid SVG for operational status', () => {
    const svg = generateBadgeSvg('API', 'operational');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('#4c1');
    expect(svg).toContain('operational');
  });

  it('generates valid SVG for degraded status', () => {
    const svg = generateBadgeSvg('Service', 'degraded');
    expect(svg).toContain('#dfb317');
    expect(svg).toContain('degraded');
  });

  it('generates valid SVG for partial_outage status', () => {
    const svg = generateBadgeSvg('DB', 'partial_outage');
    expect(svg).toContain('#fe7d37');
    expect(svg).toContain('partial outage');
  });

  it('generates valid SVG for major_outage status', () => {
    const svg = generateBadgeSvg('Web', 'major_outage');
    expect(svg).toContain('#e05d44');
    expect(svg).toContain('major outage');
  });

  it('generates valid SVG for maintenance status', () => {
    const svg = generateBadgeSvg('CDN', 'maintenance');
    expect(svg).toContain('#007ec6');
    expect(svg).toContain('maintenance');
  });

  it('generates valid SVG for unknown status', () => {
    const svg = generateBadgeSvg('Cache', 'unknown');
    expect(svg).toContain('#9f9f9f');
    expect(svg).toContain('unknown');
  });

  it('supports custom label text', () => {
    const svg = generateBadgeSvg('My Custom Service', 'operational');
    expect(svg).toContain('My Custom Service');
  });

  it('supports custom status text override', () => {
    const svg = generateBadgeSvg('API', 'operational', 'all good');
    expect(svg).toContain('all good');
    // Should still use operational color
    expect(svg).toContain('#4c1');
  });

  it('escapes XML special characters in label', () => {
    const svg = generateBadgeSvg('A<B&C>"D\'E', 'operational');
    expect(svg).not.toContain('<B&C>');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&gt;');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&apos;');
    // Must be valid XML - no unescaped special chars outside tags
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('escapes XML special characters in status text', () => {
    const svg = generateBadgeSvg('Test', 'operational', 'status <ok>');
    expect(svg).toContain('status &lt;ok&gt;');
  });

  it('includes accessibility attributes', () => {
    const svg = generateBadgeSvg('API', 'operational');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label=');
    expect(svg).toContain('<title>');
  });

  it('getStatusText returns human-readable text', () => {
    expect(getStatusText('operational')).toBe('operational');
    expect(getStatusText('partial_outage')).toBe('partial outage');
    expect(getStatusText('major_outage')).toBe('major outage');
  });

  it('getStatusColor returns correct hex color', () => {
    expect(getStatusColor('operational')).toBe('#4c1');
    expect(getStatusColor('degraded')).toBe('#dfb317');
    expect(getStatusColor('major_outage')).toBe('#e05d44');
  });
});

// ── Unit Tests: Widget HTML Generation ──

describe('Widget HTML Generation', () => {
  it('generates valid HTML with services', () => {
    const services = [
      { id: 'svc-1', name: 'API', status: 'operational' as const },
      { id: 'svc-2', name: 'Web', status: 'degraded' as const },
    ];
    const html = generateWidgetHtml(services, 'degraded');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('API');
    expect(html).toContain('Web');
    expect(html).toContain('Operational');
    expect(html).toContain('Degraded');
  });

  it('shows overall status banner by default', () => {
    const html = generateWidgetHtml(
      [{ id: 'svc-1', name: 'API', status: 'operational' as const }],
      'operational',
    );
    expect(html).toContain('All Systems Operational');
  });

  it('hides overall status when configured', () => {
    const html = generateWidgetHtml(
      [{ id: 'svc-1', name: 'API', status: 'operational' as const }],
      'operational',
      { showOverallStatus: false },
    );
    expect(html).not.toContain('All Systems Operational');
  });

  it('uses custom title when provided', () => {
    const html = generateWidgetHtml(
      [{ id: 'svc-1', name: 'API', status: 'operational' as const }],
      'operational',
      { title: 'My Service Status' },
    );
    expect(html).toContain('My Service Status');
  });

  it('includes status page link when URL provided', () => {
    const html = generateWidgetHtml(
      [{ id: 'svc-1', name: 'API', status: 'operational' as const }],
      'operational',
      { statusPageUrl: 'https://status.example.com' },
    );
    expect(html).toContain('https://status.example.com');
    expect(html).toContain('View Status Page');
  });

  it('shows empty state when no services', () => {
    const html = generateWidgetHtml([], 'unknown');
    expect(html).toContain('No services configured');
  });

  it('escapes HTML in service names', () => {
    const services = [
      { id: 'svc-1', name: '<script>alert("xss")</script>', status: 'operational' as const },
    ];
    const html = generateWidgetHtml(services, 'operational');
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes colored status dots', () => {
    const services = [
      { id: 'svc-1', name: 'API', status: 'major_outage' as const },
    ];
    const html = generateWidgetHtml(services, 'major_outage');
    expect(html).toContain('#e05d44');
    expect(html).toContain('Major Outage');
  });
});

// ── Integration Tests: Badge Endpoints ──

describe('Badge API Endpoints', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/badge/overall', () => {
    it('returns SVG with correct content type and cache headers', async () => {
      const services = [
        fakeService({ status: 'operational' }),
        fakeService({ id: 'svc-2', status: 'operational' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app)
        .get('/api/badge/overall')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => { data += chunk; });
          r.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      const svg = res.body as string;
      expect(svg).toContain('<svg');
      expect(svg).toContain('operational');
    });

    it('uses custom label from query parameter', async () => {
      const services = [fakeService({ status: 'operational' })];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app)
        .get('/api/badge/overall?label=uptime')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => { data += chunk; });
          r.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      const svg = res.body as string;
      expect(svg).toContain('uptime');
    });

    it('returns major_outage badge when any service has major outage', async () => {
      const services = [
        fakeService({ status: 'operational' }),
        fakeService({ id: 'svc-2', status: 'major_outage' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app)
        .get('/api/badge/overall')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => { data += chunk; });
          r.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      const svg = res.body as string;
      expect(svg).toContain('#e05d44');
      expect(svg).toContain('major outage');
    });

    it('returns 500 on storage error', async () => {
      vi.mocked(listServices).mockReturnValue({
        ok: false,
        error: { code: 'QUERY_FAILED', message: 'DB error' },
      });

      const res = await request(app).get('/api/badge/overall');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/badge/:serviceId', () => {
    it('returns SVG badge for a specific service', async () => {
      vi.mocked(getService).mockReturnValue({
        ok: true,
        data: fakeService({ status: 'degraded' }),
      });

      const res = await request(app)
        .get('/api/badge/svc-1')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => { data += chunk; });
          r.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      const svg = res.body as string;
      expect(svg).toContain('#dfb317');
      expect(svg).toContain('degraded');
    });

    it('uses service name as default label', async () => {
      vi.mocked(getService).mockReturnValue({
        ok: true,
        data: fakeService({ name: 'My API' }),
      });

      const res = await request(app)
        .get('/api/badge/svc-1')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => { data += chunk; });
          r.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      const svg = res.body as string;
      expect(svg).toContain('My API');
    });

    it('uses custom label from query parameter', async () => {
      vi.mocked(getService).mockReturnValue({
        ok: true,
        data: fakeService(),
      });

      const res = await request(app)
        .get('/api/badge/svc-1?label=custom+name')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => { data += chunk; });
          r.on('end', () => cb(null, data));
        });

      expect(res.status).toBe(200);
      const svg = res.body as string;
      expect(svg).toContain('custom name');
    });

    it('returns 404 for non-existent service', async () => {
      vi.mocked(getService).mockReturnValue({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Service not found' },
      });

      const res = await request(app).get('/api/badge/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/embed/widget', () => {
    it('returns HTML with correct content type', async () => {
      const services = [
        fakeService({ status: 'operational' }),
        fakeService({ id: 'svc-2', name: 'Database', status: 'degraded' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app).get('/api/embed/widget');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<!DOCTYPE html>');
      expect(res.text).toContain('API Gateway');
      expect(res.text).toContain('Database');
    });

    it('uses custom title from query parameter', async () => {
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [] });

      const res = await request(app).get('/api/embed/widget?title=My+Status');

      expect(res.status).toBe(200);
      expect(res.text).toContain('My Status');
    });

    it('returns 500 on storage error', async () => {
      vi.mocked(listServices).mockReturnValue({
        ok: false,
        error: { code: 'QUERY_FAILED', message: 'DB error' },
      });

      const res = await request(app).get('/api/embed/widget');
      expect(res.status).toBe(500);
    });
  });
});
