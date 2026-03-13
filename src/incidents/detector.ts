/**
 * StatusOwl — Incident Detector
 *
 * Auto-detects incidents from health check results.
 * Rules:
 * - If a service has 3+ consecutive failures, open an incident
 * - If a service recovers (successful check after failures), resolve the incident
 */

import { getDb } from '../storage/database.js';
import { ok, err, createChildLogger } from '../core/index.js';
import type { Result, CheckResult, Incident, ServiceStatus } from '../core/index.js';
import {
  createIncident,
  resolveIncident,
  getOpenIncidents,
  getIncidentsByService,
  getIncidentById,
} from './incident-repo.js';
import { notifyIncident } from '../notifications/index.js';
import { isInMaintenanceWindow } from '../maintenance/index.js';
import { getAlertPolicyByService, isInCooldown, recordAlertTime } from '../alerts/index.js';

const log = createChildLogger('IncidentDetector');

export interface IncidentDetectionResult {
  created: Incident[];
  resolved: Incident[];
  errors: string[];
}

const FAILURE_STATUSES: ServiceStatus[] = ['degraded', 'partial_outage', 'major_outage'];
const SUCCESS_STATUS: ServiceStatus = 'operational';
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/**
 * Detect incidents from recent check results.
 * 
 * This function processes recent check results and:
 * 1. Creates new incidents for services with 3+ consecutive failures
 * 2. Resolves existing incidents when a service recovers
 */
export async function detectIncidents(): Promise<Result<IncidentDetectionResult>> {
  const db = getDb();
  const result: IncidentDetectionResult = {
    created: [],
    resolved: [],
    errors: [],
  };

  try {
    // Get all enabled services
    const servicesResult = db.prepare(
      'SELECT id, name FROM services WHERE enabled = 1'
    ).all() as Record<string, string>[];

    for (const service of servicesResult) {
      const detectionResult = await processServiceChecks(service.id, service.name, db);
      
      if (detectionResult.created) {
        result.created.push(detectionResult.created);
      }
      if (detectionResult.resolved) {
        result.resolved.push(detectionResult.resolved);
      }
      if (detectionResult.error) {
        result.errors.push(detectionResult.error);
      }
    }

    log.info(
      { created: result.created.length, resolved: result.resolved.length, errors: result.errors.length },
      'Incident detection completed'
    );

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Incident detection failed');
    return err('DETECTION_FAILED', msg);
  }
}

/**
 * Process checks for a single service to detect new incidents or resolutions.
 * Uses per-service alert policies when available, falling back to defaults.
 */
async function processServiceChecks(
  serviceId: string,
  serviceName: string,
  db: ReturnType<typeof getDb>
): Promise<{ created?: Incident; resolved?: Incident; error?: string }> {
  try {
    // Load per-service alert policy (if one exists and is enabled)
    const policyResult = getAlertPolicyByService(serviceId);
    const policy = policyResult.ok ? policyResult.data : null;
    const policyEnabled = policy?.enabled ?? true;

    // Determine the effective failure threshold from the policy or fallback
    const effectiveThreshold = (policy && policyEnabled)
      ? policy.failureThreshold
      : CONSECUTIVE_FAILURE_THRESHOLD;

    // Determine the effective cooldown from the policy or fallback (default 0 = no cooldown)
    const effectiveCooldown = (policy && policyEnabled)
      ? policy.cooldownMinutes
      : 0;

    // Get recent checks for this service (enough to detect consecutive failures)
    const recentChecks = db.prepare(`
      SELECT * FROM check_results
      WHERE service_id = ?
      ORDER BY checked_at DESC, ROWID DESC
      LIMIT ?
    `).all(serviceId, effectiveThreshold + 5) as Record<string, unknown>[];

    if (recentChecks.length === 0) {
      return {};
    }

    // Get existing open incident for this service
    const existingIncidentsResult = getIncidentsByService(serviceId);
    const existingIncident = existingIncidentsResult.ok
      ? existingIncidentsResult.data.find((i) => i.status !== 'resolved')
      : undefined;

    // Analyze check results
    const checks = recentChecks.map(rowToCheck);
    const failureCount = countConsecutiveFailures(checks);
    const hasRecentSuccess = checks.length > 0 && checks[0].status === SUCCESS_STATUS;

    // Skip incident creation if service is in a maintenance window
    if (isInMaintenanceWindow(serviceId)) {
      log.debug({ serviceId, serviceName }, 'Service in maintenance window, skipping incident detection');
      return {};
    }

    // Rule 1: Create incident if consecutive failures >= threshold and no open incident
    if (failureCount >= effectiveThreshold && !existingIncident) {
      // Check cooldown — suppress duplicate alerts within the cooldown period
      if (effectiveCooldown > 0 && isInCooldown(serviceId, effectiveCooldown)) {
        log.debug({ serviceId, serviceName, cooldownMinutes: effectiveCooldown }, 'Service in alert cooldown, skipping incident creation');
        return {};
      }

      const title = `Service "${serviceName}" is down`;
      const severity = determineSeverity(checks);

      const createResult = createIncident(serviceId, title, severity);

      if (createResult.ok) {
        log.info({ serviceId, serviceName, failureCount, threshold: effectiveThreshold }, 'Created new incident');

        // Record alert time for cooldown tracking
        recordAlertTime(serviceId);

        // Send notifications
        await notifyIncident(createResult.data, 'created').catch((e) => {
          log.error({ incidentId: createResult.data.id, error: e }, 'Failed to send incident notifications');
        });

        return { created: createResult.data };
      } else {
        return { error: `Failed to create incident: ${createResult.error.message}` };
      }
    }

    // Rule 2: Resolve incident if service has recovered
    if (existingIncident && hasRecentSuccess) {
      const resolution = `Service "${serviceName}" has recovered`;

      const resolveResult = resolveIncident(db, existingIncident.id, resolution);

      if (resolveResult.ok) {
        log.info({ serviceId, serviceName, incidentId: existingIncident.id }, 'Resolved incident');

        // Send notifications
        await notifyIncident(resolveResult.data, 'resolved').catch((e) => {
          log.error({ incidentId: resolveResult.data.id, error: e }, 'Failed to send incident notifications');
        });

        return { resolved: resolveResult.data };
      } else {
        return { error: `Failed to resolve incident: ${resolveResult.error.message}` };
      }
    }

    return {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Error processing service ${serviceId}: ${msg}` };
  }
}

/**
 * Count consecutive failures from the most recent check going backwards.
 */
function countConsecutiveFailures(checks: CheckResult[]): number {
  let count = 0;
  
  for (const check of checks) {
    if (isFailure(check.status)) {
      count++;
    } else {
      // If we hit a success, stop counting (we want consecutive failures)
      break;
    }
  }
  
  return count;
}

/**
 * Check if a status represents a failure.
 */
function isFailure(status: ServiceStatus): boolean {
  return FAILURE_STATUSES.includes(status);
}

/**
 * Determine incident severity based on check results.
 */
function determineSeverity(checks: CheckResult[]): 'minor' | 'major' | 'critical' {
  // Look at the most recent checks to determine severity
  const recentFailures = checks.slice(0, CONSECUTIVE_FAILURE_THRESHOLD);
  
  const hasCritical = recentFailures.some((c) => c.status === 'major_outage');
  const hasMajor = recentFailures.some((c) => c.status === 'partial_outage');
  const hasDegraded = recentFailures.some((c) => c.status === 'degraded');
  
  if (hasCritical) return 'critical';
  if (hasMajor) return 'major';
  if (hasDegraded) return 'minor';
  
  return 'minor';
}

/**
 * Convert a database row to a CheckResult object.
 */
function rowToCheck(row: Record<string, unknown>): CheckResult {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    status: row.status as ServiceStatus,
    responseTime: row.response_time as number,
    statusCode: row.status_code as number | null,
    errorMessage: row.error_message as string | null,
    checkedAt: row.checked_at as string,
  };
}

/**
 * Get all open incidents (convenience function).
 */
export function getOpenIncidentsForApi(): Result<Incident[]> {
  return getOpenIncidents();
}

/**
 * Get incidents by service ID (convenience function).
 */
export function getIncidentsForService(serviceId: string): Result<Incident[]> {
  return getIncidentsByService(serviceId);
}

/**
 * Get a single incident by ID (convenience function).
 */
export function getIncident(incidentId: string): Result<Incident> {
  return getIncidentById(incidentId);
}
