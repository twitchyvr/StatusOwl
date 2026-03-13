/**
 * StatusOwl — Monitor Scheduler
 *
 * Runs health checks on configured intervals for all enabled services.
 */

import { createChildLogger } from '../core/index.js';
import { listServices, updateServiceStatus, recordCheck } from '../storage/index.js';
import { checkService } from './checker.js';
import { detectIncidents } from '../incidents/detector.js';
import type { Service } from '../core/index.js';

const log = createChildLogger('Scheduler');

const timers = new Map<string, NodeJS.Timeout>();
let _running = false;

export function startScheduler(): void {
  if (_running) return;
  _running = true;

  const result = listServices({ enabled: true });
  if (!result.ok) {
    log.error({ error: result.error }, 'Failed to load services for scheduler');
    return;
  }

  log.info({ count: result.data.length }, 'Starting monitor scheduler');

  for (const service of result.data) {
    scheduleService(service);
  }
}

export function stopScheduler(): void {
  _running = false;
  for (const [id, timer] of timers) {
    clearInterval(timer);
    timers.delete(id);
  }
  log.info('Scheduler stopped');
}

export function scheduleService(service: Service): void {
  // Clear existing timer if re-scheduling
  const existing = timers.get(service.id);
  if (existing) clearInterval(existing);

  // Run check immediately, then on interval
  runCheck(service);

  const timer = setInterval(() => {
    runCheck(service);
  }, service.checkInterval * 1000);

  timers.set(service.id, timer);
  log.info({ id: service.id, name: service.name, interval: service.checkInterval }, 'Scheduled service');
}

export function unscheduleService(serviceId: string): void {
  const timer = timers.get(serviceId);
  if (timer) {
    clearInterval(timer);
    timers.delete(serviceId);
    log.info({ id: serviceId }, 'Unscheduled service');
  }
}

async function runCheck(service: Service): Promise<void> {
  try {
    const outcome = checkService(service);
    const result = await outcome;

    // Record the check result
    recordCheck(
      service.id,
      result.status,
      result.responseTime,
      result.statusCode,
      result.errorMessage,
    );

    // Update service status if changed
    updateServiceStatus(service.id, result.status);

    // Run incident detection after each check
    await detectIncidents();

    log.debug({
      id: service.id,
      name: service.name,
      status: result.status,
      responseTime: Math.round(result.responseTime),
    }, 'Check completed');
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.error({ serviceId: service.id, error: errorMessage }, 'Check failed unexpectedly');

    // Update service status to major_outage on unexpected failures
    // so the status page reflects reality even when the checker itself throws
    updateServiceStatus(service.id, 'major_outage');
    recordCheck(service.id, 'major_outage', 0, null, `Scheduler error: ${errorMessage}`);

    // Still run incident detection so auto-incidents work
    await detectIncidents().catch((detectionErr) => {
      log.error({ serviceId: service.id, error: detectionErr }, 'Incident detection failed after scheduler error');
    });
  }
}

export function getScheduledCount(): number {
  return timers.size;
}
