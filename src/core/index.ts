/**
 * StatusOwl — Core barrel export
 */

export { loadConfig, getConfig } from './config.js';
export type { Config } from './config.js';

export { getLogger, createChildLogger } from './logger.js';

export { ok, err } from './contracts.js';
export type {
  Result,
  Assertion,
  Service,
  CreateService,
  ServiceGroup,
  CreateServiceGroup,
  ServiceStatus,
  CheckResult,
  Incident,
  IncidentUpdate,
  IncidentSeverity,
  IncidentStatus,
  Webhook,
  UptimeSummary,
  UptimeReport,
  MaintenanceWindow,
  CreateMaintenanceWindow,
  BodyValidation,
  AlertPolicy,
  CreateAlertPolicy,
  ServiceDependency,
  AuditAction,
  AuditLogEntry,
  Subscription,
  MonitoringRegion,
  SlaTarget,
  CreateSlaTarget,
  HealthScore,
  HealthScoreBreakdown,
  HealthScoreWeights,
  SlaCompliance,
  Tag,
  ServiceTag,
} from './contracts.js';

export {
  AssertionSchema,
  ServiceSchema,
  CreateServiceSchema,
  CreateServiceGroupSchema,
  ServiceGroupSchema,
  CheckResultSchema,
  IncidentSchema,
  IncidentUpdateSchema,
  WebhookSchema,
  WebhookEventType,
  MaintenanceWindowSchema,
  CreateMaintenanceWindowSchema,
  BodyValidationSchema,
  AlertPolicySchema,
  CreateAlertPolicySchema,
  ServiceDependencySchema,
  AuditActionSchema,
  AuditLogEntrySchema,
  SubscriptionSchema,
  UptimeReportSchema,
  MonitoringRegionSchema,
  SlaTargetSchema,
  CreateSlaTargetSchema,
  EvaluationPeriod,
  TagSchema,
  ServiceTagSchema,
} from './contracts.js';
