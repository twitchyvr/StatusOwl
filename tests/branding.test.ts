/**
 * Branding Tests
 *
 * Tests for branding configuration defaults, validation, and API endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// Mock storage, monitors, incidents, alerts, maintenance, audit, and auth
// (required by routes.ts imports even though we only test /api/branding)
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

vi.mock('../src/monitors/percentile-aggregator.js', () => ({
  getPercentiles: vi.fn(),
}));

vi.mock('../src/incidents/index.js', () => ({
  getOpenIncidents: vi.fn(),
  getIncidentById: vi.fn(),
  getIncidentsByService: vi.fn(),
  updateIncidentStatus: vi.fn(),
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

vi.mock('../src/storage/database.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => ({ count: 0 })),
    })),
  })),
  closeDb: vi.fn(),
}));

vi.mock('../src/api/auth.js', () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { router } from '../src/api/routes.js';
import { getConfig } from '../src/core/config.js';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('Branding', () => {
  describe('Config defaults', () => {
    it('should have default primaryColor', () => {
      const config = getConfig();
      expect(config.primaryColor).toBe('#2563eb');
    });

    it('should have default accentColor', () => {
      const config = getConfig();
      expect(config.accentColor).toBe('#059669');
    });

    it('should have logoUrl as undefined when no env var set', () => {
      const config = getConfig();
      expect(config.logoUrl).toBeUndefined();
    });

    it('should have faviconUrl as undefined when no env var set', () => {
      const config = getConfig();
      expect(config.faviconUrl).toBeUndefined();
    });

    it('should have primaryColor as a string', () => {
      const config = getConfig();
      expect(typeof config.primaryColor).toBe('string');
    });

    it('should have accentColor as a string', () => {
      const config = getConfig();
      expect(typeof config.accentColor).toBe('string');
    });

    it('should have default siteName', () => {
      const config = getConfig();
      expect(config.siteName).toBe('StatusOwl');
    });

    it('should have default siteDescription', () => {
      const config = getConfig();
      expect(config.siteDescription).toBe('Service Status');
    });
  });

  describe('GET /api/branding', () => {
    let app: express.Express;

    beforeEach(() => {
      app = buildApp();
    });

    it('should return 200 with branding data', async () => {
      const res = await request(app).get('/api/branding');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('should return all branding fields', async () => {
      const res = await request(app).get('/api/branding');
      const data = res.body.data;

      expect(data).toHaveProperty('siteName');
      expect(data).toHaveProperty('siteDescription');
      expect(data).toHaveProperty('logoUrl');
      expect(data).toHaveProperty('primaryColor');
      expect(data).toHaveProperty('accentColor');
      expect(data).toHaveProperty('faviconUrl');
    });

    it('should return default values when no env vars set', async () => {
      const res = await request(app).get('/api/branding');
      const data = res.body.data;

      expect(data.siteName).toBe('StatusOwl');
      expect(data.siteDescription).toBe('Service Status');
      expect(data.primaryColor).toBe('#2563eb');
      expect(data.accentColor).toBe('#059669');
      expect(data.logoUrl).toBeNull();
      expect(data.faviconUrl).toBeNull();
    });

    it('should return null for optional URL fields when not configured', async () => {
      const res = await request(app).get('/api/branding');
      const data = res.body.data;

      // Optional URL fields should be null (not undefined) in the JSON response
      expect(data.logoUrl).toBeNull();
      expect(data.faviconUrl).toBeNull();
    });

    it('should return string values for color fields', async () => {
      const res = await request(app).get('/api/branding');
      const data = res.body.data;

      expect(typeof data.primaryColor).toBe('string');
      expect(typeof data.accentColor).toBe('string');
    });
  });
});
