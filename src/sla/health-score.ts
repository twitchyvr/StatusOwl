/**
 * StatusOwl — Health Score & SLA Compliance
 *
 * Calculates a composite health score (0-100) from uptime, response time,
 * error rate, and incident count. Also evaluates SLA compliance against
 * configured targets.
 */

import { ok, err, createChildLogger } from '../core/index.js';
import { getDb } from '../storage/database.js';
import { getUptimeSummary } from '../storage/index.js';
import { getSlaTargetByService } from './sla-repo.js';
import type { Result, HealthScore, SlaCompliance, HealthScoreWeights } from '../core/index.js';

const log = createChildLogger('HealthScore');

/** Default weights for each health score component */
const DEFAULT_WEIGHTS: HealthScoreWeights = {
  uptime: 0.40,
  responseTime: 0.25,
  errorRate: 0.20,
  incidents: 0.15,
};

/**
 * Normalize uptime percentage to a 0-100 score.
 * 100% uptime = 100, scales linearly to 0 at 90% uptime.
 * Below 90% = 0.
 */
export function normalizeUptimeScore(uptimePercent: number): number {
  if (uptimePercent >= 100) return 100;
  if (uptimePercent <= 90) return 0;
  // Linear interpolation: 90% -> 0, 100% -> 100
  return ((uptimePercent - 90) / 10) * 100;
}

/**
 * Normalize average response time to a 0-100 score.
 * <=100ms = 100, scales linearly to 0 at >=5000ms.
 */
export function normalizeResponseTimeScore(avgResponseTimeMs: number): number {
  if (avgResponseTimeMs <= 100) return 100;
  if (avgResponseTimeMs >= 5000) return 0;
  // Linear interpolation: 100ms -> 100, 5000ms -> 0
  return ((5000 - avgResponseTimeMs) / 4900) * 100;
}

/**
 * Normalize error rate to a 0-100 score.
 * 0% errors = 100, 100% errors = 0.
 */
export function normalizeErrorRateScore(totalChecks: number, successfulChecks: number): number {
  if (totalChecks === 0) return 100; // No data = assume no errors
  const errorPercent = ((totalChecks - successfulChecks) / totalChecks) * 100;
  return Math.max(0, 100 - errorPercent);
}

/**
 * Normalize incident count to a 0-100 score.
 * 0 incidents = 100. Each incident reduces the score by 20, floored at 0.
 */
export function normalizeIncidentScore(incidentCount: number): number {
  if (incidentCount <= 0) return 100;
  return Math.max(0, 100 - incidentCount * 20);
}

/**
 * Count open and recent incidents for a service within the evaluation period.
 */
function countRecentIncidents(serviceId: string, periodHours: number): number {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(DISTINCT i.id) as count
      FROM incidents i
      JOIN incident_services isvc ON i.id = isvc.incident_id
      WHERE isvc.service_id = ?
        AND i.created_at >= datetime('now', '-' || ? || ' hours')
    `).get(serviceId, periodHours) as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

/**
 * Calculate a composite health score for a service.
 *
 * The score is a weighted average of four normalized metrics:
 * - Uptime (40%): 100 if 100%, linear to 0 at 90%
 * - Response time (25%): 100 if <100ms, linear to 0 at >5000ms
 * - Error rate (20%): inverse of error percentage
 * - Incident count (15%): 100 if 0, decreases by 20 per incident
 */
export function calculateHealthScore(serviceId: string): Result<HealthScore> {
  try {
    // Get uptime summary for the last 30 days
    const uptimeResult = getUptimeSummary(serviceId, '30d');
    if (!uptimeResult.ok) {
      return err('QUERY_FAILED', `Failed to get uptime data: ${uptimeResult.error.message}`);
    }

    const summary = uptimeResult.data;

    // Count recent incidents (last 30 days = 720 hours)
    const incidentCount = countRecentIncidents(serviceId, 720);

    // Calculate individual component scores
    const uptimeScore = normalizeUptimeScore(summary.uptimePercent);
    const responseTimeScore = normalizeResponseTimeScore(summary.avgResponseTime);
    const errorRateScore = normalizeErrorRateScore(summary.totalChecks, summary.successfulChecks);
    const incidentScore = normalizeIncidentScore(incidentCount);

    // Weighted composite score
    const score = Math.round(
      uptimeScore * DEFAULT_WEIGHTS.uptime +
      responseTimeScore * DEFAULT_WEIGHTS.responseTime +
      errorRateScore * DEFAULT_WEIGHTS.errorRate +
      incidentScore * DEFAULT_WEIGHTS.incidents
    );

    return ok({
      score: Math.max(0, Math.min(100, score)),
      breakdown: {
        uptimeScore: Math.round(uptimeScore * 100) / 100,
        responseTimeScore: Math.round(responseTimeScore * 100) / 100,
        errorRateScore: Math.round(errorRateScore * 100) / 100,
        incidentScore: Math.round(incidentScore * 100) / 100,
      },
      weights: DEFAULT_WEIGHTS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ serviceId, error: msg }, 'Failed to calculate health score');
    return err('CALCULATION_FAILED', msg);
  }
}

/**
 * Calculate SLA compliance for a service against its configured target.
 *
 * Compares actual uptime and response time against the SLA target.
 * Uses the evaluation period to determine the lookback window.
 */
export function calculateSlaCompliance(serviceId: string): Result<SlaCompliance> {
  try {
    // Get the SLA target for this service
    const targetResult = getSlaTargetByService(serviceId);
    if (!targetResult.ok) {
      return err('QUERY_FAILED', `Failed to get SLA target: ${targetResult.error.message}`);
    }

    if (!targetResult.data) {
      return err('NOT_FOUND', `No SLA target configured for service ${serviceId}`);
    }

    const target = targetResult.data;

    // Determine the lookback period based on evaluation period
    const periodMap: Record<string, '30d' | '90d'> = {
      monthly: '30d',
      quarterly: '90d',
    };
    const period = periodMap[target.evaluationPeriod] ?? '30d';

    // Get actual uptime data
    const uptimeResult = getUptimeSummary(serviceId, period);
    if (!uptimeResult.ok) {
      return err('QUERY_FAILED', `Failed to get uptime data: ${uptimeResult.error.message}`);
    }

    const summary = uptimeResult.data;

    const uptimeActual = summary.uptimePercent;
    const responseTimeActual = summary.avgResponseTime;

    // Determine compliance: both uptime AND response time must meet targets
    const uptimeCompliant = uptimeActual >= target.uptimeTarget;
    const responseTimeCompliant = responseTimeActual <= target.responseTimeTarget;
    const compliant = uptimeCompliant && responseTimeCompliant;

    return ok({
      target,
      actual: {
        uptimeActual,
        responseTimeActual,
      },
      compliant,
      uptimeActual,
      responseTimeActual,
      period: target.evaluationPeriod,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ serviceId, error: msg }, 'Failed to calculate SLA compliance');
    return err('CALCULATION_FAILED', msg);
  }
}
