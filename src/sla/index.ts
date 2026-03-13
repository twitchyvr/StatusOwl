/**
 * StatusOwl — SLA Module
 *
 * Barrel export for SLA targets, health scores, and compliance.
 */

export {
  createSlaTarget,
  getSlaTarget,
  getSlaTargetByService,
  updateSlaTarget,
  deleteSlaTarget,
  listSlaTargets,
} from './sla-repo.js';

export {
  calculateHealthScore,
  calculateSlaCompliance,
  normalizeUptimeScore,
  normalizeResponseTimeScore,
  normalizeErrorRateScore,
  normalizeIncidentScore,
} from './health-score.js';
