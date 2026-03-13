/**
 * Assertion Evaluator Tests
 *
 * Pure-function tests for evaluateAssertions — no DB or setup.ts needed.
 * Tests all 8 assertion types (pass + fail), overall status determination,
 * empty assertions array, and multiple failure scenarios.
 */

import { describe, it, expect } from 'vitest';
import { evaluateAssertions } from '../src/monitors/assertion-evaluator.js';
import type { AssertionContext, AssertionResult } from '../src/monitors/assertion-evaluator.js';
import type { Assertion } from '../src/core/contracts.js';

// ── Helper: build a default context ──

function makeContext(overrides: Partial<AssertionContext> = {}): AssertionContext {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123' },
    responseTime: 150,
    bodyText: JSON.stringify({ status: 'ok', data: { count: 42 } }),
    sslDaysRemaining: 90,
    ...overrides,
  };
}

/** Shorthand for building an assertion. */
function a(
  type: Assertion['type'],
  expression: string,
  severity: 'warning' | 'critical' = 'critical',
  expectedValue?: string,
): Assertion {
  return expectedValue !== undefined
    ? { type, expression, expectedValue, severity }
    : { type, expression, severity };
}

// ══════════════════════════════════════════════════════════════════════
// 1. status_code
// ══════════════════════════════════════════════════════════════════════

describe('assertion: status_code', () => {
  it('passes when status code matches the expression', () => {
    const ctx = makeContext({ statusCode: 200 });
    const { results } = evaluateAssertions([a('status_code', '200')], ctx);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].actualValue).toBe('200');
  });

  it('fails when status code does not match', () => {
    const ctx = makeContext({ statusCode: 503 });
    const { results } = evaluateAssertions([a('status_code', '200')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('503');
    expect(results[0].message).toContain('Expected status code 200');
    expect(results[0].message).toContain('503');
  });

  it('reports "null" when statusCode is null', () => {
    const ctx = makeContext({ statusCode: null });
    const { results } = evaluateAssertions([a('status_code', '200')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('null');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. header_exists
// ══════════════════════════════════════════════════════════════════════

describe('assertion: header_exists', () => {
  it('passes when the header exists (case-insensitive)', () => {
    const ctx = makeContext({ headers: { 'Content-Type': 'text/html' } });
    const { results } = evaluateAssertions([a('header_exists', 'content-type')], ctx);

    expect(results[0].passed).toBe(true);
  });

  it('fails when the header is absent', () => {
    const ctx = makeContext({ headers: {} });
    const { results } = evaluateAssertions([a('header_exists', 'x-custom')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('(absent)');
    expect(results[0].message).toContain('not found');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. header_value
// ══════════════════════════════════════════════════════════════════════

describe('assertion: header_value', () => {
  it('passes when header value matches expectedValue', () => {
    const ctx = makeContext({ headers: { 'Content-Type': 'application/json' } });
    const { results } = evaluateAssertions(
      [a('header_value', 'Content-Type', 'critical', 'application/json')],
      ctx,
    );

    expect(results[0].passed).toBe(true);
    expect(results[0].actualValue).toBe('application/json');
  });

  it('fails when header value does not match', () => {
    const ctx = makeContext({ headers: { 'Content-Type': 'text/html' } });
    const { results } = evaluateAssertions(
      [a('header_value', 'Content-Type', 'critical', 'application/json')],
      ctx,
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('text/html');
    expect(results[0].message).toContain('expected "application/json"');
    expect(results[0].message).toContain('text/html');
  });

  it('fails when header is completely absent', () => {
    const ctx = makeContext({ headers: {} });
    const { results } = evaluateAssertions(
      [a('header_value', 'X-Missing', 'critical', 'something')],
      ctx,
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('(absent)');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. response_time_lt
// ══════════════════════════════════════════════════════════════════════

describe('assertion: response_time_lt', () => {
  it('passes when response time is below threshold', () => {
    const ctx = makeContext({ responseTime: 100 });
    const { results } = evaluateAssertions([a('response_time_lt', '500')], ctx);

    expect(results[0].passed).toBe(true);
    expect(results[0].actualValue).toBe('100ms');
  });

  it('fails when response time exceeds threshold', () => {
    const ctx = makeContext({ responseTime: 750 });
    const { results } = evaluateAssertions([a('response_time_lt', '500')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('750ms');
    expect(results[0].message).toContain('exceeds');
  });

  it('fails when response time exactly equals the threshold', () => {
    const ctx = makeContext({ responseTime: 500 });
    const { results } = evaluateAssertions([a('response_time_lt', '500')], ctx);

    // "less than" means 500 is NOT less than 500
    expect(results[0].passed).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. body_contains
// ══════════════════════════════════════════════════════════════════════

describe('assertion: body_contains', () => {
  it('passes when body contains the substring', () => {
    const ctx = makeContext({ bodyText: 'Hello, world!' });
    const { results } = evaluateAssertions([a('body_contains', 'world')], ctx);

    expect(results[0].passed).toBe(true);
  });

  it('fails when body does not contain the substring', () => {
    const ctx = makeContext({ bodyText: 'Hello, world!' });
    const { results } = evaluateAssertions([a('body_contains', 'galaxy')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('galaxy');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. body_regex
// ══════════════════════════════════════════════════════════════════════

describe('assertion: body_regex', () => {
  it('passes when body matches the regex pattern', () => {
    const ctx = makeContext({ bodyText: 'error code: 503' });
    const { results } = evaluateAssertions([a('body_regex', '\\d{3}')], ctx);

    expect(results[0].passed).toBe(true);
  });

  it('fails when body does not match the regex pattern', () => {
    const ctx = makeContext({ bodyText: 'no numbers here' });
    const { results } = evaluateAssertions([a('body_regex', '^\\d+$')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('does not match');
  });

  it('returns failure with descriptive message for invalid regex', () => {
    const ctx = makeContext({ bodyText: 'anything' });
    const { results } = evaluateAssertions([a('body_regex', '[invalid')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].message).toMatch(/[Ii]nvalid regex/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. body_json_path
// ══════════════════════════════════════════════════════════════════════

describe('assertion: body_json_path', () => {
  it('passes when JSON path exists and value matches expectedValue', () => {
    const ctx = makeContext({ bodyText: JSON.stringify({ status: 'ok' }) });
    const { results } = evaluateAssertions(
      [a('body_json_path', 'status', 'critical', 'ok')],
      ctx,
    );

    expect(results[0].passed).toBe(true);
    expect(results[0].actualValue).toBe('ok');
  });

  it('fails when JSON path exists but value does not match', () => {
    const ctx = makeContext({ bodyText: JSON.stringify({ status: 'error' }) });
    const { results } = evaluateAssertions(
      [a('body_json_path', 'status', 'critical', 'ok')],
      ctx,
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('error');
    expect(results[0].message).toContain('expected "ok"');
  });

  it('passes for path existence when no expectedValue is given', () => {
    const ctx = makeContext({ bodyText: JSON.stringify({ data: { count: 42 } }) });
    const { results } = evaluateAssertions(
      [a('body_json_path', 'data.count')],
      ctx,
    );

    expect(results[0].passed).toBe(true);
    expect(results[0].actualValue).toBe('42');
  });

  it('fails when JSON path does not exist', () => {
    const ctx = makeContext({ bodyText: JSON.stringify({ data: {} }) });
    const { results } = evaluateAssertions(
      [a('body_json_path', 'data.missing', 'critical', 'value')],
      ctx,
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('(not found)');
  });

  it('fails when body is not valid JSON', () => {
    const ctx = makeContext({ bodyText: '<html>not json</html>' });
    const { results } = evaluateAssertions(
      [a('body_json_path', 'status', 'critical', 'ok')],
      ctx,
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].message).toMatch(/[Ff]ailed to parse/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. ssl_days_remaining
// ══════════════════════════════════════════════════════════════════════

describe('assertion: ssl_days_remaining', () => {
  it('passes when SSL days remaining meets the minimum', () => {
    const ctx = makeContext({ sslDaysRemaining: 90 });
    const { results } = evaluateAssertions([a('ssl_days_remaining', '30')], ctx);

    expect(results[0].passed).toBe(true);
    expect(results[0].actualValue).toBe('90 days');
  });

  it('fails when SSL days remaining is below the minimum', () => {
    const ctx = makeContext({ sslDaysRemaining: 5 });
    const { results } = evaluateAssertions([a('ssl_days_remaining', '30')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('5 days');
    expect(results[0].message).toContain('only 5 days');
  });

  it('fails when sslDaysRemaining is null (no SSL data)', () => {
    const ctx = makeContext({ sslDaysRemaining: null });
    const { results } = evaluateAssertions([a('ssl_days_remaining', '30')], ctx);

    expect(results[0].passed).toBe(false);
    expect(results[0].actualValue).toBe('unknown');
    expect(results[0].message).toContain('not available');
  });

  it('passes when SSL days remaining exactly equals the minimum', () => {
    const ctx = makeContext({ sslDaysRemaining: 30 });
    const { results } = evaluateAssertions([a('ssl_days_remaining', '30')], ctx);

    // >= check, so 30 >= 30 passes
    expect(results[0].passed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Overall status determination
// ══════════════════════════════════════════════════════════════════════

describe('overall status determination', () => {
  it('returns "operational" when all assertions pass', () => {
    const ctx = makeContext({ statusCode: 200, responseTime: 100, sslDaysRemaining: 90 });
    const { overallStatus } = evaluateAssertions(
      [
        a('status_code', '200', 'critical'),
        a('response_time_lt', '500', 'warning'),
        a('ssl_days_remaining', '30', 'warning'),
      ],
      ctx,
    );

    expect(overallStatus).toBe('operational');
  });

  it('returns "degraded" when only warning-severity assertions fail', () => {
    const ctx = makeContext({ responseTime: 750 });
    const { overallStatus } = evaluateAssertions(
      [
        a('status_code', '200', 'critical'),
        a('response_time_lt', '500', 'warning'),
      ],
      ctx,
    );

    expect(overallStatus).toBe('degraded');
  });

  it('returns "major_outage" when any critical-severity assertion fails', () => {
    const ctx = makeContext({ statusCode: 503 });
    const { overallStatus } = evaluateAssertions(
      [
        a('status_code', '200', 'critical'),
        a('response_time_lt', '500', 'warning'),
      ],
      ctx,
    );

    expect(overallStatus).toBe('major_outage');
  });

  it('returns "major_outage" when both warning and critical assertions fail (critical wins)', () => {
    const ctx = makeContext({ statusCode: 503, responseTime: 750 });
    const { overallStatus } = evaluateAssertions(
      [
        a('status_code', '200', 'critical'),
        a('response_time_lt', '500', 'warning'),
      ],
      ctx,
    );

    expect(overallStatus).toBe('major_outage');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Edge cases
// ══════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('returns "operational" and empty results for empty assertions array', () => {
    const ctx = makeContext();
    const { results, overallStatus } = evaluateAssertions([], ctx);

    expect(results).toHaveLength(0);
    expect(overallStatus).toBe('operational');
  });

  it('handles multiple failures and reports all results', () => {
    const ctx = makeContext({
      statusCode: 500,
      responseTime: 2000,
      sslDaysRemaining: 3,
      bodyText: 'Internal Server Error',
    });

    const assertions: Assertion[] = [
      a('status_code', '200', 'critical'),
      a('response_time_lt', '500', 'warning'),
      a('ssl_days_remaining', '14', 'critical'),
      a('body_contains', '"status":"ok"', 'warning'),
    ];

    const { results, overallStatus } = evaluateAssertions(assertions, ctx);

    expect(results).toHaveLength(4);

    // All should fail
    const failedCount = results.filter((r: AssertionResult) => !r.passed).length;
    expect(failedCount).toBe(4);

    // Critical failures present -> major_outage
    expect(overallStatus).toBe('major_outage');
  });

  it('preserves the original assertion object in each result', () => {
    const assertion = a('status_code', '200', 'critical');
    const ctx = makeContext({ statusCode: 200 });
    const { results } = evaluateAssertions([assertion], ctx);

    expect(results[0].assertion).toBe(assertion);
    expect(results[0].assertion.type).toBe('status_code');
    expect(results[0].assertion.severity).toBe('critical');
  });
});
