/**
 * Body Validator Tests
 *
 * Pure-function tests for validateBody — no DB or setup.ts needed.
 */

import { describe, it, expect } from 'vitest';
import { validateBody } from '../src/monitors/body-validator.js';
import type { ValidationResult } from '../src/monitors/body-validator.js';

// ── helpers ──

/** Shorthand for a 'contains' rule. */
function containsRule(expression: string) {
  return { type: 'contains' as const, expression };
}

/** Shorthand for a 'regex' rule. */
function regexRule(expression: string) {
  return { type: 'regex' as const, expression };
}

/** Shorthand for a 'json_path' rule, optionally with expectedValue. */
function jsonPathRule(expression: string, expectedValue?: string) {
  return { type: 'json_path' as const, expression, expectedValue };
}

// ── contains ──

describe('validateBody — contains', () => {
  it('returns valid when the body contains the substring', () => {
    const result = validateBody('Hello, world!', containsRule('world'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('returns invalid when the body does not contain the substring', () => {
    const result = validateBody('Hello, world!', containsRule('galaxy'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('galaxy');
  });

  it('performs case-sensitive matching', () => {
    const result = validateBody('Hello, World!', containsRule('world'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).not.toBeNull();
  });

  it('returns invalid for an empty body', () => {
    const result = validateBody('', containsRule('anything'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('anything');
  });

  it('returns valid when searching for an empty substring in non-empty body', () => {
    // String.prototype.includes('') is always true
    const result = validateBody('some content', containsRule(''));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('matches substrings at the very start of the body', () => {
    const result = validateBody('OK — all clear', containsRule('OK'));

    expect(result.valid).toBe(true);
  });

  it('matches substrings at the very end of the body', () => {
    const result = validateBody('status: healthy', containsRule('healthy'));

    expect(result.valid).toBe(true);
  });
});

// ── regex ──

describe('validateBody — regex', () => {
  it('returns valid when the body matches the regex', () => {
    const result = validateBody('HTTP/1.1 200 OK', regexRule('200'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('returns invalid when the body does not match the regex', () => {
    const result = validateBody('HTTP/1.1 404 Not Found', regexRule('^2\\d{2}$'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('^2\\d{2}$');
  });

  it('handles complex digit patterns (\\d{3})', () => {
    const result = validateBody('error code 503 returned', regexRule('\\d{3}'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('supports anchored patterns', () => {
    const pass = validateBody('OK', regexRule('^OK$'));
    expect(pass.valid).toBe(true);

    const fail = validateBody('NOT OK', regexRule('^OK$'));
    expect(fail.valid).toBe(false);
  });

  it('returns invalid with a descriptive error for an invalid regex', () => {
    const result = validateBody('anything', regexRule('[invalid'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).not.toBeNull();
    expect(result.errorMessage).toMatch(/[Ii]nvalid regex pattern/);
  });

  it('supports multiline content matching', () => {
    const body = 'line one\nline two\nline three';
    const result = validateBody(body, regexRule('line two'));

    expect(result.valid).toBe(true);
  });

  it('supports character classes and quantifiers', () => {
    const result = validateBody(
      'user@example.com',
      regexRule('[a-z]+@[a-z]+\\.[a-z]+'),
    );

    expect(result.valid).toBe(true);
  });
});

// ── json_path ──

describe('validateBody — json_path', () => {
  const simpleJson = JSON.stringify({ status: 'ok', code: 200 });
  const nestedJson = JSON.stringify({
    data: {
      items: [
        { name: 'alpha', value: 1 },
        { name: 'beta', value: 2 },
      ],
      meta: { total: 2 },
    },
  });
  const arrayJson = JSON.stringify({
    items: ['first', 'second', 'third'],
  });

  // ── path existence (no expectedValue) ──

  it('returns valid when the path exists (no expectedValue)', () => {
    const result = validateBody(simpleJson, jsonPathRule('status'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('returns invalid when the path does not exist', () => {
    const result = validateBody(simpleJson, jsonPathRule('missing'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('missing');
    expect(result.errorMessage).toContain('not found');
  });

  // ── path + expectedValue ──

  it('returns valid when path exists and value matches expectedValue', () => {
    const result = validateBody(simpleJson, jsonPathRule('status', 'ok'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('returns invalid when value does not match expectedValue', () => {
    const result = validateBody(simpleJson, jsonPathRule('status', 'error'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('ok');
    expect(result.errorMessage).toContain('error');
  });

  it('coerces numeric values to string for comparison', () => {
    const result = validateBody(simpleJson, jsonPathRule('code', '200'));

    expect(result.valid).toBe(true);
  });

  // ── nested paths ──

  it('resolves deeply nested paths (data.meta.total)', () => {
    const result = validateBody(nestedJson, jsonPathRule('data.meta.total', '2'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('resolves nested path with array index (data.items.0.name)', () => {
    const result = validateBody(nestedJson, jsonPathRule('data.items.0.name', 'alpha'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('resolves second element via nested path (data.items.1.name)', () => {
    const result = validateBody(nestedJson, jsonPathRule('data.items.1.name', 'beta'));

    expect(result.valid).toBe(true);
  });

  // ── array index access ──

  it('accesses array elements by index (items.0)', () => {
    const result = validateBody(arrayJson, jsonPathRule('items.0', 'first'));

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it('accesses last array element by index (items.2)', () => {
    const result = validateBody(arrayJson, jsonPathRule('items.2', 'third'));

    expect(result.valid).toBe(true);
  });

  it('returns invalid for out-of-bounds array index', () => {
    const result = validateBody(arrayJson, jsonPathRule('items.99'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('not found');
  });

  // ── non-JSON body ──

  it('returns invalid with parse error for non-JSON body', () => {
    const result = validateBody('<html>not json</html>', jsonPathRule('status'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).not.toBeNull();
    expect(result.errorMessage).toMatch(/[Ff]ailed to parse.*JSON/);
  });

  it('returns invalid with parse error for empty body', () => {
    const result = validateBody('', jsonPathRule('status'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toMatch(/[Ff]ailed to parse.*JSON/);
  });

  // ── edge cases ──

  it('handles null value at path correctly', () => {
    const body = JSON.stringify({ key: null });
    // null is not undefined — the path exists
    const result = validateBody(body, jsonPathRule('key'));

    expect(result.valid).toBe(true);
  });

  it('handles boolean values with expectedValue comparison', () => {
    const body = JSON.stringify({ active: true });
    const result = validateBody(body, jsonPathRule('active', 'true'));

    expect(result.valid).toBe(true);
  });

  it('returns invalid when path traverses a non-object scalar', () => {
    const body = JSON.stringify({ name: 'hello' });
    const result = validateBody(body, jsonPathRule('name.nested'));

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('not found');
  });
});
