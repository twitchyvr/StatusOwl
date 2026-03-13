/**
 * API Routes Tests
 *
 * Tests the Express router endpoints with mocked storage, monitors, and incidents.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// Mocks — declared before importing the module under test
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

import { router } from '../src/api/routes.js';
import {
  createService,
  getService,
  listServices,
  updateService,
  deleteService,
  getRecentChecks,
  getUptimeSummary,
} from '../src/storage/index.js';
import {
  getOpenIncidents,
  getIncidentById,
  getIncidentsByService,
  updateIncidentStatus,
} from '../src/incidents/index.js';

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

describe('API Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/services', () => {
    it('returns a list of services', async () => {
      const services = [fakeService(), fakeService({ id: 'svc-2', name: 'Web App' })];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app).get('/api/services');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('returns 500 on storage error', async () => {
      vi.mocked(listServices).mockReturnValue({ ok: false, error: { code: 'QUERY_FAILED', message: 'DB error' } });

      const res = await request(app).get('/api/services');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/services/:id', () => {
    it('returns a single service', async () => {
      vi.mocked(getService).mockReturnValue({ ok: true, data: fakeService() });

      const res = await request(app).get('/api/services/svc-1');
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('API Gateway');
    });

    it('returns 404 for missing service', async () => {
      vi.mocked(getService).mockReturnValue({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });

      const res = await request(app).get('/api/services/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/services', () => {
    it('creates a service and returns 201', async () => {
      const svc = fakeService();
      vi.mocked(createService).mockReturnValue({ ok: true, data: svc });

      const res = await request(app)
        .post('/api/services')
        .send({ name: 'API Gateway', url: 'https://api.example.com/health' });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 on invalid body', async () => {
      const res = await request(app)
        .post('/api/services')
        .send({ name: '' }); // name must be min 1 char

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('PATCH /api/services/:id', () => {
    it('updates a service', async () => {
      const svc = fakeService({ name: 'Updated' });
      vi.mocked(updateService).mockReturnValue({ ok: true, data: svc });

      const res = await request(app)
        .patch('/api/services/svc-1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated');
    });

    it('returns 404 for missing service', async () => {
      vi.mocked(updateService).mockReturnValue({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });

      const res = await request(app)
        .patch('/api/services/nonexistent')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });

    it('returns 400 on invalid body', async () => {
      const res = await request(app)
        .patch('/api/services/svc-1')
        .send({ checkInterval: -1 }); // must be >= 10

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/services/:id', () => {
    it('deletes a service', async () => {
      vi.mocked(deleteService).mockReturnValue({ ok: true, data: undefined });

      const res = await request(app).delete('/api/services/svc-1');
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing service', async () => {
      vi.mocked(deleteService).mockReturnValue({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });

      const res = await request(app).delete('/api/services/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/status', () => {
    it('returns operational when all services operational', async () => {
      const services = [
        fakeService({ status: 'operational' }),
        fakeService({ id: 'svc-2', status: 'operational' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('operational');
    });

    it('returns major_outage when any service is major_outage', async () => {
      const services = [
        fakeService({ status: 'operational' }),
        fakeService({ id: 'svc-2', status: 'major_outage' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app).get('/api/status');
      expect(res.body.data.status).toBe('major_outage');
    });

    it('returns partial_outage when any service is partial_outage', async () => {
      const services = [
        fakeService({ status: 'operational' }),
        fakeService({ id: 'svc-2', status: 'partial_outage' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app).get('/api/status');
      expect(res.body.data.status).toBe('partial_outage');
    });

    it('returns degraded for non-operational non-outage', async () => {
      const services = [
        fakeService({ status: 'degraded' }),
      ];
      vi.mocked(listServices).mockReturnValue({ ok: true, data: services });

      const res = await request(app).get('/api/status');
      expect(res.body.data.status).toBe('degraded');
    });
  });

  describe('GET /api/incidents', () => {
    it('returns open incidents', async () => {
      vi.mocked(getOpenIncidents).mockReturnValue({
        ok: true,
        data: [{ id: 'inc-1', title: 'Outage', serviceIds: [] }],
      });

      const res = await request(app).get('/api/incidents');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/incidents/:id', () => {
    it('returns an incident by id', async () => {
      vi.mocked(getIncidentById).mockReturnValue({
        ok: true,
        data: { id: 'inc-1', title: 'Outage' },
      });

      const res = await request(app).get('/api/incidents/inc-1');
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing incident', async () => {
      vi.mocked(getIncidentById).mockReturnValue({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
      });

      const res = await request(app).get('/api/incidents/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/incidents/:id/update', () => {
    it('validates required fields', async () => {
      const res = await request(app)
        .post('/api/incidents/inc-1/update')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('validates status values', async () => {
      const res = await request(app)
        .post('/api/incidents/inc-1/update')
        .send({ status: 'invalid', message: 'test' });

      expect(res.status).toBe(400);
    });

    it('updates incident on valid input', async () => {
      vi.mocked(updateIncidentStatus).mockReturnValue({ ok: true, data: undefined });

      const res = await request(app)
        .post('/api/incidents/inc-1/update')
        .send({ status: 'resolved', message: 'All clear' });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/services/:id/checks', () => {
    it('returns recent checks', async () => {
      vi.mocked(getRecentChecks).mockReturnValue({ ok: true, data: [] });

      const res = await request(app).get('/api/services/svc-1/checks');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/services/:id/uptime', () => {
    it('validates period parameter', async () => {
      const res = await request(app).get('/api/services/svc-1/uptime?period=1y');
      expect(res.status).toBe(400);
    });

    it('accepts valid period', async () => {
      vi.mocked(getUptimeSummary).mockReturnValue({ ok: true, data: { uptimePercent: 99.9 } });

      const res = await request(app).get('/api/services/svc-1/uptime?period=90d');
      expect(res.status).toBe(200);
    });
  });
});
