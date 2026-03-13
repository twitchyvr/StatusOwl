/**
 * StatusOwl — Core barrel export
 */

export { loadConfig, getConfig } from './config.js';
export type { Config } from './config.js';

export { getLogger, createChildLogger } from './logger.js';

export { ok, err } from './contracts.js';
export type {
  Result,
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
  MaintenanceWindow,
  CreateMaintenanceWindow,
  BodyValidation,
} from './contracts.js';

export {
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
} from './contracts.js';
