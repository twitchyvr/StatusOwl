/**
 * StatusOwl — API Routes
 *
 * RESTful API for services, checks, incidents, and status.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { CreateServiceSchema, CreateServiceGroupSchema, CreateMaintenanceWindowSchema, CreateAlertPolicySchema, getConfig } from '../core/index.js';
import { createService, getService, listServices, listServicesPaginated, updateService, deleteService } from '../storage/index.js';
import { getRecentChecks, getUptimeSummary, getDailyHistory, getLatestSslCheck, getSslHistory } from '../storage/index.js';
import { getPercentiles } from '../monitors/percentile-aggregator.js';
import { createGroup, getGroup, listGroups, updateGroup, deleteGroup } from '../storage/index.js';
import {
  createMaintenanceWindow,
  getMaintenanceWindow,
  listMaintenanceWindows,
  deleteMaintenanceWindow,
} from '../maintenance/index.js';
import { scheduleService, unscheduleService } from '../monitors/index.js';
import {
  getOpenIncidents,
  getIncidentById,
  getIncidentsByService,
  updateIncidentStatus,
} from '../incidents/index.js';
import { getDb } from '../storage/database.js';
import { requireAuth } from './auth.js';
import { buildPaginatedResponse, decodeCursor } from './pagination.js';
import { registerClient, requestGrant, introspectToken, revokeToken, rotateToken } from '../auth/index.js';
import {
  createAlertPolicy,
  getAlertPolicy,
  getAlertPolicyByService,
  listAlertPolicies,
  updateAlertPolicy,
  deleteAlertPolicy,
} from '../alerts/index.js';
import { recordAudit, queryAuditLog } from '../audit/index.js';
import { addDependency, removeDependency, getDependenciesOf, getDependentsOn, getDownstreamServices } from '../storage/index.js';
import { createSubscription, confirmSubscription, unsubscribe, listSubscriptions, deleteSubscription } from '../subscriptions/index.js';
import { generateReport, getReport, listReports } from '../reports/index.js';
import { createRegion, listRegions, getRegion, deleteRegion, getRegionalLatency } from '../monitors/region-repo.js';

// ── In-memory rate limiter (sliding window) ──

interface RateLimitEntry {
  timestamps: number[];
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;  // max requests per window

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries from the rate limit store.
 * Runs periodically to prevent memory leaks.
 */
function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    if (entry.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup every 5 minutes
const _rateLimitCleanupTimer = setInterval(cleanupRateLimitStore, 5 * 60_000);
// Allow the process to exit without waiting for the timer
if (_rateLimitCleanupTimer.unref) {
  _rateLimitCleanupTimer.unref();
}

/**
 * Rate limiting middleware using a sliding window approach.
 * Identifies clients by IP address. Returns 429 when limit is exceeded.
 */
export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();

  let entry = rateLimitStore.get(clientIp);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(clientIp, entry);
  }

  // Remove timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Try again in ${retryAfter} seconds.`,
      },
    });
    return;
  }

  entry.timestamps.push(now);
  next();
}

export const router = Router();

// Apply rate limiting to all API routes
router.use(rateLimit);

// ── GNAP Authorization ──

router.post('/api/auth/register', requireAuth, (req: Request, res: Response) => {
  const { clientId, secret } = req.body;
  if (!clientId || !secret) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'clientId and secret are required' } });
  }
  const result = registerClient(clientId, secret);
  if (!result.ok) return res.status(500).json(result);
  recordAudit('auth.register', 'client', clientId, { detail: clientId });
  res.status(201).json(result);
});

router.post('/api/auth/grant', (req: Request, res: Response) => {
  const { client, accessScopes, resources, clientSecret } = req.body;
  if (!client || !accessScopes || !clientSecret) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'client, accessScopes, and clientSecret are required' } });
  }
  const result = requestGrant({ client, accessScopes, resources }, clientSecret);
  if (!result.ok) {
    const status = result.error.code === 'UNAUTHORIZED' ? 401 : 400;
    return res.status(status).json(result);
  }
  recordAudit('auth.grant', 'client', client, { detail: `scopes: ${accessScopes.join(', ')}` });
  res.status(200).json(result);
});

router.post('/api/auth/introspect', (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'token is required' } });
  }
  const result = introspectToken(token);
  if (!result.ok) return res.status(500).json(result);
  res.json({ ok: true, data: { active: result.data !== null, token: result.data } });
});

router.post('/api/auth/revoke', (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'token is required' } });
  }
  const result = revokeToken(token);
  if (!result.ok) return res.status(500).json(result);
  recordAudit('auth.revoke', 'token', token.substring(0, 8), { detail: 'Token revoked' });
  res.json(result);
});

router.post('/api/auth/rotate', (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'token is required' } });
  }
  const result = rotateToken(token);
  if (!result.ok) return res.status(500).json(result);
  if (!result.data) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Token not found or expired' } });
  }
  res.json(result);
});

// ── Services ──

router.get('/api/services', (_req, res) => {
  const result = listServices();
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/services/:id', (req, res) => {
  const result = getService(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.post('/api/services', requireAuth, (req: Request, res: Response) => {
  const parsed = CreateServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = createService(parsed.data);
  if (!result.ok) return res.status(500).json(result);

  // Auto-schedule if enabled
  if (result.data.enabled) {
    scheduleService(result.data);
  }

  recordAudit('service.create', 'service', result.data.id, { detail: result.data.name });
  res.status(201).json(result);
});

router.patch('/api/services/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  // Validate input against partial schema
  const UpdateSchema = CreateServiceSchema.partial();
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = updateService(req.params.id, parsed.data);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }

  // Reschedule if interval or enabled changed
  if (result.data.enabled) {
    scheduleService(result.data);
  } else {
    unscheduleService(result.data.id);
  }

  recordAudit('service.update', 'service', result.data.id, { detail: result.data.name });
  res.json(result);
});

router.delete('/api/services/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  unscheduleService(req.params.id);
  const result = deleteService(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  recordAudit('service.delete', 'service', req.params.id);
  res.json(result);
});

// ── Service Groups ──

router.get('/api/groups', (_req, res) => {
  const result = listGroups();
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/groups/:id', (req, res) => {
  const result = getGroup(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.post('/api/groups', requireAuth, (req: Request, res: Response) => {
  const parsed = CreateServiceGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = createGroup(parsed.data);
  if (!result.ok) return res.status(500).json(result);
  recordAudit('group.create', 'group', result.data.id, { detail: result.data.name });
  res.status(201).json(result);
});

router.patch('/api/groups/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const UpdateSchema = CreateServiceGroupSchema.partial();
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = updateGroup(req.params.id, parsed.data);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  recordAudit('group.update', 'group', result.data.id, { detail: result.data.name });
  res.json(result);
});

router.delete('/api/groups/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = deleteGroup(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  recordAudit('group.delete', 'group', req.params.id);
  res.json(result);
});

// ── Health Checks ──

router.get('/api/services/:id/checks', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const result = getRecentChecks(req.params.id, limit);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/services/:id/uptime', (req, res) => {
  const period = (req.query.period as string) || '24h';
  if (!['24h', '7d', '30d', '90d'].includes(period)) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'period must be 24h, 7d, 30d, or 90d' } });
  }
  const result = getUptimeSummary(req.params.id, period as '24h' | '7d' | '30d' | '90d');
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/services/:id/uptime/history', (req, res) => {
  const days = parseInt(req.query.days as string) || 90;
  if (days < 1 || days > 365) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'days must be between 1 and 365' } });
  }
  const result = getDailyHistory(req.params.id, days);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

// ── SSL Certificate ──

router.get('/api/services/:id/ssl', (req, res) => {
  const result = getLatestSslCheck(req.params.id);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/services/:id/ssl/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 30;
  const result = getSslHistory(req.params.id, limit);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

// ── Response Time Percentiles ──

router.get('/api/services/:id/percentiles', (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24;
  if (hours < 1 || hours > 720) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'hours must be between 1 and 720' } });
  }
  const result = getPercentiles(req.params.id, hours);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

// ── Status (public) ──

router.get('/api/status', (_req, res) => {
  const result = listServices({ enabled: true });
  if (!result.ok) return res.status(500).json(result);

  const services = result.data;
  const allOperational = services.every(s => s.status === 'operational');
  const anyMajor = services.some(s => s.status === 'major_outage');
  const anyPartialOutage = services.some(s => s.status === 'partial_outage');
  const anyMaintenance = services.every(s => s.status === 'maintenance');

  let overallStatus: string;
  if (allOperational) overallStatus = 'operational';
  else if (anyMajor) overallStatus = 'major_outage';
  else if (anyPartialOutage) overallStatus = 'partial_outage';
  else if (anyMaintenance) overallStatus = 'maintenance';
  else overallStatus = 'degraded';

  res.json({
    ok: true,
    data: {
      status: overallStatus,
      services: services.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        groupId: s.groupId,
      })),
    },
  });
});

// ── Branding (public) ──

router.get('/api/branding', (_req, res) => {
  const config = getConfig();
  res.json({
    ok: true,
    data: {
      siteName: config.siteName,
      siteDescription: config.siteDescription,
      logoUrl: config.logoUrl ?? null,
      primaryColor: config.primaryColor,
      accentColor: config.accentColor,
      faviconUrl: config.faviconUrl ?? null,
    },
  });
});

// ── Maintenance Windows ──

router.get('/api/maintenance-windows', (_req, res) => {
  const serviceId = _req.query.serviceId as string | undefined;
  const active = _req.query.active === 'true';
  const result = listMaintenanceWindows({ serviceId, active: active || undefined });
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/maintenance-windows/:id', (req, res) => {
  const result = getMaintenanceWindow(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.post('/api/maintenance-windows', requireAuth, (req: Request, res: Response) => {
  const parsed = CreateMaintenanceWindowSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = createMaintenanceWindow(parsed.data);
  if (!result.ok) {
    const status = result.error.code === 'VALIDATION' ? 400 : 500;
    return res.status(status).json(result);
  }
  recordAudit('maintenance.create', 'maintenance', result.data.id, { detail: result.data.title });
  res.status(201).json(result);
});

router.delete('/api/maintenance-windows/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = deleteMaintenanceWindow(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  recordAudit('maintenance.delete', 'maintenance', req.params.id);
  res.json(result);
});

// ── Incidents ──

router.get('/api/incidents', (_req, res) => {
  const result = getOpenIncidents();
  if (!result.ok) return res.status(500).json(result);

  // Attach timeline to each incident so the status page can render them
  const db = getDb();
  const getTimeline = db.prepare(
    'SELECT id, incident_id AS "incidentId", status, message, created_at AS "createdAt" FROM incident_updates WHERE incident_id = ? ORDER BY created_at ASC'
  );
  const incidents = result.data.map((incident: Record<string, unknown>) => ({
    ...incident,
    timeline: getTimeline.all(incident.id as string),
  }));

  res.json({ ok: true, data: incidents });
});

router.get('/api/incidents/:id', (req, res) => {
  const result = getIncidentById(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }

  // Attach timeline entries for the status page
  const db = getDb();
  const updates = db.prepare(
    'SELECT id, incident_id AS "incidentId", status, message, created_at AS "createdAt" FROM incident_updates WHERE incident_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);

  res.json({ ...result, data: { ...result.data, timeline: updates } });
});

router.get('/api/services/:id/incidents', (req, res) => {
  const result = getIncidentsByService(req.params.id);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.post('/api/incidents/:id/update', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const { status, message } = req.body;

  if (!status || !message) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: 'status and message are required' }
    });
  }

  const validStatuses = ['investigating', 'identified', 'monitoring', 'resolved'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: 'status must be one of: investigating, identified, monitoring, resolved' }
    });
  }

  const result = updateIncidentStatus(req.params.id, status, message);
  if (!result.ok) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(statusCode).json(result);
  }

  const auditAction = status === 'resolved' ? 'incident.resolve' as const : 'incident.update' as const;
  recordAudit(auditAction, 'incident', req.params.id, { detail: `${status}: ${message}` });
  res.json(result);
});

// ── Alert Policies ──

router.get('/api/alert-policies', (_req, res) => {
  const result = listAlertPolicies();
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/alert-policies/:id', (req, res) => {
  const result = getAlertPolicy(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.get('/api/services/:id/alert-policy', (req, res) => {
  const result = getAlertPolicyByService(req.params.id);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.post('/api/alert-policies', requireAuth, (req: Request, res: Response) => {
  const parsed = CreateAlertPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = createAlertPolicy(parsed.data);
  if (!result.ok) return res.status(500).json(result);
  recordAudit('alert_policy.create', 'alert_policy', result.data.id, { detail: `service: ${result.data.serviceId}` });
  res.status(201).json(result);
});

router.patch('/api/alert-policies/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const UpdateSchema = CreateAlertPolicySchema.partial();
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } });
  }

  const result = updateAlertPolicy(req.params.id, parsed.data);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  recordAudit('alert_policy.update', 'alert_policy', result.data.id, { detail: `service: ${result.data.serviceId}` });
  res.json(result);
});

router.delete('/api/alert-policies/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = deleteAlertPolicy(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  recordAudit('alert_policy.delete', 'alert_policy', req.params.id);
  res.json(result);
});

// ── Service Dependencies ──

router.get('/api/services/:id/dependencies', (req, res) => {
  const result = getDependenciesOf(req.params.id);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/services/:id/dependents', (req, res) => {
  const result = getDependentsOn(req.params.id);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/services/:id/downstream', (req, res) => {
  const result = getDownstreamServices(req.params.id);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.post('/api/services/:id/dependencies', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const { childServiceId } = req.body;
  if (!childServiceId) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'childServiceId is required' } });
  }
  const result = addDependency(req.params.id, childServiceId);
  if (!result.ok) {
    const status = result.error.code === 'VALIDATION' || result.error.code === 'DUPLICATE' ? 400 : 500;
    return res.status(status).json(result);
  }
  res.status(201).json(result);
});

router.delete('/api/dependencies/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = removeDependency(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

// ── Subscriptions ──

router.post('/api/subscriptions', (req: Request, res: Response) => {
  const { email, serviceId } = req.body;
  if (!email) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'email is required' } });
  }
  const result = createSubscription(email, serviceId);
  if (!result.ok) {
    const status = result.error.code === 'DUPLICATE' ? 409 : 500;
    return res.status(status).json(result);
  }
  // In production, send confirmation email here
  res.status(201).json({ ok: true, data: { id: result.data.id, message: 'Please check your email to confirm subscription' } });
});

router.get('/api/subscriptions/confirm/:token', (req, res) => {
  const result = confirmSubscription(req.params.token);
  if (!result.ok) {
    return res.status(404).json(result);
  }
  res.json({ ok: true, data: { message: 'Subscription confirmed' } });
});

router.get('/api/subscriptions/unsubscribe/:token', (req, res) => {
  const result = unsubscribe(req.params.token);
  if (!result.ok) {
    return res.status(404).json(result);
  }
  res.json({ ok: true, data: { message: 'Successfully unsubscribed' } });
});

router.get('/api/subscriptions', requireAuth, (_req, res) => {
  const result = listSubscriptions();
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.delete('/api/subscriptions/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = deleteSubscription(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

// ── Reports ──

router.get('/api/reports', (req, res) => {
  const period = req.query.period as string | undefined;
  const limit = parseInt(req.query.limit as string) || 30;
  const result = listReports({ period, limit });
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.get('/api/reports/:id', (req, res) => {
  const result = getReport(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.post('/api/reports/generate', requireAuth, (req: Request, res: Response) => {
  const period = req.body.period as string;
  if (!period || !['daily', 'weekly'].includes(period)) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'period must be daily or weekly' } });
  }
  const result = generateReport(period as 'daily' | 'weekly');
  if (!result.ok) return res.status(500).json(result);
  res.status(201).json(result);
});


// ── Audit Log ──

router.get('/api/audit-log', requireAuth, (req, res) => {
  const action = req.query.action as string | undefined;
  const resourceType = req.query.resourceType as string | undefined;
  const resourceId = req.query.resourceId as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const result = queryAuditLog({ action, resourceType, resourceId, limit, offset });
  if (!result.ok) return res.status(500).json(result);
  res.json({ ok: true, data: result.data.entries, pagination: { total: result.data.total, limit, offset } });
});

// ── V2 Paginated Endpoints ──

router.get('/api/v2/services', (req, res) => {
  const cursor = req.query.cursor as string | undefined;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string | undefined;
  const groupId = req.query.groupId as string | undefined;
  const enabled = req.query.enabled === undefined ? undefined : req.query.enabled === 'true';

  const result = listServicesPaginated({ cursor, limit, status, groupId, enabled });
  if (!result.ok) return res.status(500).json(result);

  const { services, total } = result.data;
  const response = buildPaginatedResponse(services, limit, (s) => s.createdAt ?? '', total);
  res.json(response);
});

router.get('/api/v2/incidents', (req, res) => {
  const cursor = req.query.cursor as string | undefined;
  const limit = parseInt(req.query.limit as string) || 20;
  const statusFilter = req.query.status as string | undefined;
  const serviceId = req.query.serviceId as string | undefined;

  try {
    const db = getDb();

    // Build filter conditions
    const filterConditions: string[] = [];
    const filterParams: unknown[] = [];

    if (statusFilter) {
      filterConditions.push('i.status = ?');
      filterParams.push(statusFilter);
    }
    if (serviceId) {
      filterConditions.push('i.id IN (SELECT incident_id FROM incident_services WHERE service_id = ?)');
      filterParams.push(serviceId);
    }

    // Count total matching the filters
    const countWhere = filterConditions.length > 0 ? `WHERE ${filterConditions.join(' AND ')}` : '';
    const totalRow = db.prepare(
      `SELECT COUNT(*) as count FROM incidents i ${countWhere}`
    ).get(...filterParams) as { count: number };

    // Add cursor condition for data query
    const dataConditions = [...filterConditions];
    const dataParams = [...filterParams];

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        dataConditions.push('(i.created_at < ? OR (i.created_at = ? AND i.id > ?))');
        dataParams.push(decoded.sortValue, decoded.sortValue, decoded.id);
      }
    }

    const dataWhere = dataConditions.length > 0 ? `WHERE ${dataConditions.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT i.* FROM incidents i ${dataWhere} ORDER BY i.created_at DESC, i.id ASC LIMIT ?`
    ).all(...dataParams, limit + 1) as Record<string, unknown>[];

    // Map rows to incident objects with service IDs
    const incidents = rows.map((row) => {
      const serviceRows = db.prepare(
        'SELECT service_id FROM incident_services WHERE incident_id = ?'
      ).all(row.id as string) as Record<string, unknown>[];

      return {
        id: row.id as string,
        title: row.title as string,
        severity: row.severity as string,
        status: row.status as string,
        serviceIds: serviceRows.map((r) => r.service_id as string),
        message: (row.message as string) ?? '',
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        resolvedAt: (row.resolved_at as string) ?? null,
      };
    });

    const response = buildPaginatedResponse(incidents, limit, (inc) => inc.createdAt ?? '', totalRow.count);
    res.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: { code: 'DB_ERROR', message: msg } });
  }
});

// ── Monitoring Regions ──

router.get('/api/regions', (_req, res) => {
  const result = listRegions();
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

router.post('/api/regions', requireAuth, (req: Request, res: Response) => {
  const { id, name, location } = req.body;
  if (!id || !name) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'id and name are required' } });
  }
  const result = createRegion(id, name, location);
  if (!result.ok) {
    const status = result.error.code === 'DUPLICATE' ? 409 : 500;
    return res.status(status).json(result);
  }
  res.status(201).json(result);
});

router.get('/api/regions/:id', (req, res) => {
  const result = getRegion(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.delete('/api/regions/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = deleteRegion(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'VALIDATION' ? 400 : 500;
    return res.status(status).json(result);
  }
  res.json(result);
});

router.get('/api/services/:id/regional-latency', (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const result = getRegionalLatency(req.params.id, hours);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});
