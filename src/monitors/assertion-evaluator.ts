/**
 * StatusOwl — Assertion Evaluator
 *
 * Evaluates a set of typed assertions against an HTTP check context.
 * Each assertion yields a pass/fail result with an actual value and message.
 * The overall service status is derived from the worst-case severity of any failure.
 *
 * Supported assertion types:
 *   status_code        — expression is the expected HTTP status code (e.g. "200")
 *   header_exists      — expression is the header name; passes if present
 *   header_value       — expression is the header name; expectedValue is the required value
 *   response_time_lt   — expression is the max allowed response time in ms (e.g. "500")
 *   body_contains      — expression is a substring the body must contain
 *   body_regex         — expression is a regex pattern the body must match
 *   body_json_path     — expression is a dot-notation JSON path; expectedValue is the required value
 *   ssl_days_remaining — expression is the minimum acceptable days until SSL expiry (e.g. "30")
 */

import { createChildLogger } from '../core/index.js';
import type { Assertion, ServiceStatus } from '../core/index.js';

const log = createChildLogger('AssertionEvaluator');

// ── Public types ──

export interface AssertionContext {
  statusCode: number | null;
  headers: Record<string, string>;
  responseTime: number;
  bodyText: string;
  sslDaysRemaining: number | null;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actualValue: string;
  message: string;
}

export interface AssertionOutcome {
  results: AssertionResult[];
  overallStatus: ServiceStatus;
}

// ── Main entry point ──

/**
 * Evaluate every assertion against the provided check context.
 * Returns individual results and an overall status derived from worst-case severity.
 */
export function evaluateAssertions(
  assertions: Assertion[],
  context: AssertionContext,
): AssertionOutcome {
  if (assertions.length === 0) {
    return { results: [], overallStatus: 'operational' };
  }

  const results: AssertionResult[] = assertions.map((assertion) =>
    evaluateOne(assertion, context),
  );

  const overallStatus = deriveOverallStatus(results);
  return { results, overallStatus };
}

// ── Single-assertion evaluator ──

function evaluateOne(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  switch (assertion.type) {
    case 'status_code':
      return evalStatusCode(assertion, ctx);
    case 'header_exists':
      return evalHeaderExists(assertion, ctx);
    case 'header_value':
      return evalHeaderValue(assertion, ctx);
    case 'response_time_lt':
      return evalResponseTimeLt(assertion, ctx);
    case 'body_contains':
      return evalBodyContains(assertion, ctx);
    case 'body_regex':
      return evalBodyRegex(assertion, ctx);
    case 'body_json_path':
      return evalBodyJsonPath(assertion, ctx);
    case 'ssl_days_remaining':
      return evalSslDaysRemaining(assertion, ctx);
    default:
      return {
        assertion,
        passed: false,
        actualValue: '',
        message: `Unknown assertion type: ${(assertion as Assertion).type}`,
      };
  }
}

// ── Type-specific evaluators ──

function evalStatusCode(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  const expected = parseInt(assertion.expression, 10);
  const actual = ctx.statusCode;
  const actualStr = actual === null ? 'null' : String(actual);
  const passed = actual === expected;

  return {
    assertion,
    passed,
    actualValue: actualStr,
    message: passed
      ? `Status code is ${actualStr} as expected`
      : `Expected status code ${expected}, got ${actualStr}`,
  };
}

function evalHeaderExists(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  const headerName = assertion.expression.toLowerCase();
  const normalizedHeaders = normalizeHeaderKeys(ctx.headers);
  const exists = headerName in normalizedHeaders;
  const actualStr = exists ? normalizedHeaders[headerName] : '(absent)';

  return {
    assertion,
    passed: exists,
    actualValue: actualStr,
    message: exists
      ? `Header "${assertion.expression}" is present`
      : `Header "${assertion.expression}" not found in response`,
  };
}

function evalHeaderValue(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  const headerName = assertion.expression.toLowerCase();
  const normalizedHeaders = normalizeHeaderKeys(ctx.headers);
  const actual = normalizedHeaders[headerName];

  if (actual === undefined) {
    return {
      assertion,
      passed: false,
      actualValue: '(absent)',
      message: `Header "${assertion.expression}" not found in response`,
    };
  }

  const expected = assertion.expectedValue ?? '';
  const passed = actual === expected;

  return {
    assertion,
    passed,
    actualValue: actual,
    message: passed
      ? `Header "${assertion.expression}" = "${actual}" as expected`
      : `Header "${assertion.expression}": expected "${expected}", got "${actual}"`,
  };
}

function evalResponseTimeLt(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  const threshold = parseFloat(assertion.expression);
  const actual = ctx.responseTime;
  const passed = actual < threshold;

  return {
    assertion,
    passed,
    actualValue: `${Math.round(actual)}ms`,
    message: passed
      ? `Response time ${Math.round(actual)}ms is under ${threshold}ms threshold`
      : `Response time ${Math.round(actual)}ms exceeds ${threshold}ms threshold`,
  };
}

function evalBodyContains(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  const substring = assertion.expression;
  const passed = ctx.bodyText.includes(substring);

  return {
    assertion,
    passed,
    actualValue: passed ? `contains "${substring}"` : `does not contain "${substring}"`,
    message: passed
      ? `Body contains "${substring}"`
      : `Body does not contain expected string: "${substring}"`,
  };
}

function evalBodyRegex(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  try {
    const regex = new RegExp(assertion.expression);
    const passed = regex.test(ctx.bodyText);

    return {
      assertion,
      passed,
      actualValue: passed ? `matches /${assertion.expression}/` : `no match for /${assertion.expression}/`,
      message: passed
        ? `Body matches pattern /${assertion.expression}/`
        : `Body does not match pattern /${assertion.expression}/`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ pattern: assertion.expression, error: msg }, 'Invalid regex in assertion');
    return {
      assertion,
      passed: false,
      actualValue: 'invalid regex',
      message: `Invalid regex pattern: ${msg}`,
    };
  }
}

function evalBodyJsonPath(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.bodyText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      assertion,
      passed: false,
      actualValue: 'invalid JSON',
      message: `Failed to parse response body as JSON: ${msg}`,
    };
  }

  const value = extractJsonPath(parsed, assertion.expression);

  if (value === undefined) {
    return {
      assertion,
      passed: false,
      actualValue: '(not found)',
      message: `JSON path "${assertion.expression}" not found in response body`,
    };
  }

  const actualStr = String(value);

  // If no expectedValue, just check path existence
  if (assertion.expectedValue === undefined) {
    return {
      assertion,
      passed: true,
      actualValue: actualStr,
      message: `JSON path "${assertion.expression}" exists with value: ${actualStr}`,
    };
  }

  const passed = actualStr === assertion.expectedValue;
  return {
    assertion,
    passed,
    actualValue: actualStr,
    message: passed
      ? `JSON path "${assertion.expression}" = "${actualStr}" as expected`
      : `JSON path "${assertion.expression}": expected "${assertion.expectedValue}", got "${actualStr}"`,
  };
}

function evalSslDaysRemaining(assertion: Assertion, ctx: AssertionContext): AssertionResult {
  const minDays = parseInt(assertion.expression, 10);
  const actual = ctx.sslDaysRemaining;

  if (actual === null) {
    return {
      assertion,
      passed: false,
      actualValue: 'unknown',
      message: 'SSL days remaining is not available (no SSL check data)',
    };
  }

  const passed = actual >= minDays;

  return {
    assertion,
    passed,
    actualValue: `${actual} days`,
    message: passed
      ? `SSL certificate has ${actual} days remaining (minimum: ${minDays})`
      : `SSL certificate has only ${actual} days remaining (minimum required: ${minDays})`,
  };
}

// ── Helpers ──

/**
 * Derive the overall service status from assertion results.
 * - All pass -> operational
 * - Any warning-severity failure -> degraded
 * - Any critical-severity failure -> major_outage
 * Worst-case wins: critical overrides warning.
 */
function deriveOverallStatus(results: AssertionResult[]): ServiceStatus {
  let hasCriticalFailure = false;
  let hasWarningFailure = false;

  for (const r of results) {
    if (!r.passed) {
      if (r.assertion.severity === 'critical') {
        hasCriticalFailure = true;
      } else {
        hasWarningFailure = true;
      }
    }
  }

  if (hasCriticalFailure) return 'major_outage';
  if (hasWarningFailure) return 'degraded';
  return 'operational';
}

/**
 * Normalize header keys to lowercase for case-insensitive comparison.
 */
function normalizeHeaderKeys(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/**
 * Extract a value from a parsed JSON object using dot-notation path.
 * Supports array indexing: "data.items.0.name"
 */
function extractJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    if (typeof current === 'object') {
      const idx = parseInt(part, 10);
      if (Array.isArray(current) && !isNaN(idx)) {
        current = current[idx];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    } else {
      return undefined;
    }
  }

  return current;
}
