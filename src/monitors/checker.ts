/**
 * StatusOwl — Health Checker
 *
 * Performs HTTP health checks against monitored services.
 */

import { createChildLogger } from '../core/index.js';
import { validateBody } from './body-validator.js';
import type { Service, ServiceStatus } from '../core/index.js';

const log = createChildLogger('Checker');

export interface CheckOutcome {
  status: ServiceStatus;
  responseTime: number;
  statusCode: number | null;
  errorMessage: string | null;
}

export async function checkService(service: Service): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), service.timeout * 1000);
  const start = performance.now();

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'StatusOwl/1.0',
      ...(service.headers ?? {}),
    };

    const response = await fetch(service.url, {
      method: service.method,
      headers,
      body: service.method === 'POST' ? service.body : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });

    const responseTime = performance.now() - start;
    clearTimeout(timeoutId);

    const isExpected = response.status === service.expectedStatus;

    if (isExpected) {
      // Run body validation if configured
      if (service.bodyValidation) {
        const bodyText = await response.text();
        const validation = validateBody(bodyText, service.bodyValidation);
        if (!validation.valid) {
          return {
            status: 'degraded',
            responseTime,
            statusCode: response.status,
            errorMessage: validation.errorMessage,
          };
        }
      }

      return {
        status: 'operational',
        responseTime,
        statusCode: response.status,
        errorMessage: null,
      };
    }

    // Unexpected status code — could be degraded or down
    const status: ServiceStatus = response.status >= 500 ? 'major_outage' : 'degraded';
    return {
      status,
      responseTime,
      statusCode: response.status,
      errorMessage: `Expected ${service.expectedStatus}, got ${response.status}`,
    };
  } catch (e) {
    const responseTime = performance.now() - start;
    clearTimeout(timeoutId);

    const error = e instanceof Error ? e : new Error(String(e));
    const isTimeout = error.name === 'AbortError';

    log.warn({ serviceId: service.id, name: service.name, error: error.message }, 'Health check failed');

    return {
      status: 'major_outage',
      responseTime,
      statusCode: null,
      errorMessage: isTimeout ? `Timeout after ${service.timeout}s` : error.message,
    };
  }
}
