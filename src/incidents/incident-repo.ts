/**
 * StatusOwl — Incident Repository
 *
 * CRUD operations for incidents and timeline updates.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../storage/database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, Incident, IncidentUpdate, IncidentSeverity, IncidentStatus } from '../core/index.js';

const log = createChildLogger('IncidentRepo');

/**
 * Create a new incident.
 */
export function createIncident(
  serviceId: string,
  title: string,
  severity: IncidentSeverity,
): Result<Incident> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO incidents (id, title, severity, status, message, created_at, updated_at)
      VALUES (?, ?, ?, 'investigating', '', ?, ?)
    `).run(id, title, severity, now, now);

    // Link the incident to the service
    db.prepare(`
      INSERT INTO incident_services (incident_id, service_id)
      VALUES (?, ?)
    `).run(id, serviceId);

    // Add initial timeline entry
    addTimelineEntry(db, id, 'investigating', `Incident created: ${title}`);

    log.info({ id, serviceId, title, severity }, 'Incident created');
    return getIncidentById(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, serviceId }, 'Failed to create incident');
    return err('CREATE_FAILED', msg);
  }
}

/**
 * Resolve an incident.
 */
export function resolveIncident(db: ReturnType<typeof getDb>, incidentId: string, resolution: string): Result<Incident> {
  try {
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE incidents
      SET status = 'resolved', resolved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, incidentId);

    // Add resolution timeline entry
    addTimelineEntry(db, incidentId, 'resolved', resolution);

    log.info({ incidentId, resolution }, 'Incident resolved');
    return getIncidentById(incidentId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, incidentId }, 'Failed to resolve incident');
    return err('UPDATE_FAILED', msg);
  }
}

/**
 * Get all open (non-resolved) incidents.
 */
export function getOpenIncidents(): Result<Incident[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM incidents
      WHERE resolved_at IS NULL
      ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];

    const incidents = rows.map((row) => rowToIncident(row, db));
    return ok(incidents);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to get open incidents');
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Get an incident by ID.
 */
export function getIncidentById(id: string): Result<Incident> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!row) return err('NOT_FOUND', `Incident ${id} not found`);

    return ok(rowToIncident(row, db));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Get all incidents for a specific service.
 */
export function getIncidentsByService(serviceId: string): Result<Incident[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT i.* FROM incidents i
      JOIN incident_services is2 ON i.id = is2.incident_id
      WHERE is2.service_id = ?
      ORDER BY i.created_at DESC
    `).all(serviceId) as Record<string, unknown>[];

    const incidents = rows.map((row) => rowToIncident(row, db));
    return ok(incidents);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, serviceId }, 'Failed to get incidents by service');
    return err('QUERY_FAILED', msg);
  }
}

/**
 * Add a timeline entry to an incident.
 */
export function addTimelineEntry(
  dbOrIncidentId: ReturnType<typeof getDb> | string,
  incidentIdOrType: string | IncidentStatus,
  typeOrMessage: IncidentStatus | string,
  message?: string,
): Result<IncidentUpdate> {
  // Handle function overloading - either (db, incidentId, type, message) or (incidentId, type, message)
  let db: ReturnType<typeof getDb>;
  let incidentId: string;
  let type: IncidentStatus;
  let msg: string;

  if (typeof dbOrIncidentId === 'string') {
    // Called as (incidentId, type, message)
    db = getDb();
    incidentId = dbOrIncidentId;
    type = typeOrMessage as IncidentStatus;
    msg = message ?? '';
  } else {
    // Called as (db, incidentId, type, message)
    db = dbOrIncidentId;
    incidentId = incidentIdOrType as string;
    type = typeOrMessage as IncidentStatus;
    msg = message ?? '';
  }

  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO incident_updates (id, incident_id, status, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, incidentId, type, msg, now);

    return ok({
      id,
      incidentId,
      status: type,
      message: msg,
      createdAt: now,
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    log.error({ error: errorMsg, incidentId }, 'Failed to add timeline entry');
    return err('INSERT_FAILED', errorMsg);
  }
}

/**
 * Update incident status.
 */
export function updateIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  message: string,
): Result<Incident> {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE incidents
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, incidentId);

    // Add timeline entry
    addTimelineEntry(db, incidentId, status, message);

    log.info({ incidentId, status }, 'Incident status updated');
    return getIncidentById(incidentId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, incidentId }, 'Failed to update incident status');
    return err('UPDATE_FAILED', msg);
  }
}

/**
 * Convert a database row to an Incident object.
 */
function rowToIncident(row: Record<string, unknown>, db: ReturnType<typeof getDb>): Incident {
  // Get linked service IDs
  const serviceRows = db.prepare(
    'SELECT service_id FROM incident_services WHERE incident_id = ?'
  ).all(row.id as string) as Record<string, unknown>[];

  const serviceIds = serviceRows.map((r) => r.service_id as string);

  return {
    id: row.id as string,
    title: row.title as string,
    severity: row.severity as IncidentSeverity,
    status: row.status as IncidentStatus,
    serviceIds,
    message: (row.message as string) ?? '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    resolvedAt: (row.resolved_at as string) ?? null,
  };
}
