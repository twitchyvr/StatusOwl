/**
 * StatusOwl — Contracts
 *
 * Shared types, Zod schemas, and Result pattern.
 */

import { z } from 'zod';

// ── Result pattern ──

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable?: boolean } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err<T>(code: string, message: string, opts?: { retryable?: boolean }): Result<T> {
  return { ok: false, error: { code, message, retryable: opts?.retryable } };
}

// ── Body Validation ──

export const BodyValidationSchema = z.object({
  type: z.enum(['contains', 'regex', 'json_path']),
  expression: z.string().min(1),
  expectedValue: z.string().optional(),
});
export type BodyValidation = z.infer<typeof BodyValidationSchema>;

// ── Service (monitored endpoint) ──

export const ServiceStatus = z.enum(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown']);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const ServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  url: z.string().url(),
  method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
  expectedStatus: z.coerce.number().default(200),
  checkInterval: z.coerce.number().min(10).max(3600).default(60), // seconds
  timeout: z.coerce.number().min(1).max(60).default(10),           // seconds
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  bodyValidation: BodyValidationSchema.optional(),
  status: ServiceStatus.default('unknown'),
  enabled: z.boolean().default(true),
  groupId: z.string().uuid().nullable().default(null),
  sortOrder: z.coerce.number().default(0),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const CreateServiceSchema = ServiceSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateService = z.infer<typeof CreateServiceSchema>;

// ── Service Group ──

export const ServiceGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(''),
  sortOrder: z.coerce.number().default(0),
  collapsed: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
});
export type ServiceGroup = z.infer<typeof ServiceGroupSchema>;

export const CreateServiceGroupSchema = ServiceGroupSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateServiceGroup = z.infer<typeof CreateServiceGroupSchema>;

// ── Health Check Result ──

export const CheckResultSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  status: ServiceStatus,
  responseTime: z.number(), // ms
  statusCode: z.number().nullable(),
  errorMessage: z.string().nullable().default(null),
  checkedAt: z.string().datetime(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

// ── Incident ──

export const IncidentSeverity = z.enum(['minor', 'major', 'critical']);
export type IncidentSeverity = z.infer<typeof IncidentSeverity>;

export const IncidentStatus = z.enum(['investigating', 'identified', 'monitoring', 'resolved']);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const IncidentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300),
  severity: IncidentSeverity,
  status: IncidentStatus,
  serviceIds: z.array(z.string().uuid()),
  message: z.string().default(''),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().nullable().default(null),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentUpdateSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  status: IncidentStatus,
  message: z.string(),
  createdAt: z.string().datetime().optional(),
});
export type IncidentUpdate = z.infer<typeof IncidentUpdateSchema>;

// ── Webhook Subscriber ──

export const WebhookEventType = z.enum([
  'service.down',
  'service.up',
  'service.degraded',
  'incident.created',
  'incident.updated',
  'incident.resolved',
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(WebhookEventType),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

// ── Maintenance Window ──

export const MaintenanceWindowSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  createdAt: z.string().datetime().optional(),
});
export type MaintenanceWindow = z.infer<typeof MaintenanceWindowSchema>;

export const CreateMaintenanceWindowSchema = MaintenanceWindowSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateMaintenanceWindow = z.infer<typeof CreateMaintenanceWindowSchema>;

// ── Uptime summary ──

export interface UptimeSummary {
  serviceId: string;
  period: '24h' | '7d' | '30d' | '90d';
  uptimePercent: number;
  totalChecks: number;
  successfulChecks: number;
  avgResponseTime: number;
}
