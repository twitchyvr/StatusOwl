/**
 * StatusOwl — API Routes
 *
 * RESTful API for services, checks, incidents, and status.
 */

import { Router, Request, Response } from 'express';
import { CreateServiceSchema } from '../core/index.js';
import { createService, getService, listServices, updateService, deleteService } from '../storage/index.js';
import { getRecentChecks, getUptimeSummary } from '../storage/index.js';
import { scheduleService, unscheduleService } from '../monitors/index.js';
import {
  getOpenIncidents,
  getIncidentById,
  getIncidentsByService,
  updateIncidentStatus,
} from '../incidents/index.js';
import { getDb } from '../storage/database.js';
import { requireAuth } from './auth.js';

export const router = Router();

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

  res.status(201).json(result);
});

router.patch('/api/services/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  const result = updateService(req.params.id, req.body);
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

  res.json(result);
});

router.delete('/api/services/:id', requireAuth, (req: Request<{id: string}>, res: Response) => {
  unscheduleService(req.params.id);
  const result = deleteService(req.params.id);
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json(result);
  }
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

// ── Status (public) ──

router.get('/api/status', (_req, res) => {
  const result = listServices({ enabled: true });
  if (!result.ok) return res.status(500).json(result);

  const services = result.data;
  const allOperational = services.every(s => s.status === 'operational');
  const anyMajor = services.some(s => s.status === 'major_outage');

  let overallStatus: string;
  if (allOperational) overallStatus = 'operational';
  else if (anyMajor) overallStatus = 'major_outage';
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

  res.json(result);
});
