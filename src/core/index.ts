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
  ServiceStatus,
  CheckResult,
  Incident,
  IncidentUpdate,
  IncidentSeverity,
  IncidentStatus,
  Webhook,
  WebhookEventType,
  UptimeSummary,
} from './contracts.js';

export {
  ServiceSchema,
  CreateServiceSchema,
  ServiceGroupSchema,
  CheckResultSchema,
  IncidentSchema,
  IncidentUpdateSchema,
  WebhookSchema,
} from './contracts.js';
