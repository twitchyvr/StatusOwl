/**
 * StatusOwl — Incidents Module
 *
 * Barrel export for incident management.
 */

export {
  createIncident,
  resolveIncident,
  getOpenIncidents,
  getIncidentById,
  getIncidentsByService,
  addTimelineEntry,
  updateIncidentStatus,
} from './incident-repo.js';

export {
  detectIncidents,
  getOpenIncidentsForApi,
  getIncidentsForService,
  getIncident,
} from './detector.js';

export type { IncidentDetectionResult } from './detector.js';
