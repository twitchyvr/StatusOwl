/**
 * StatusOwl — Response Body Validator
 *
 * Validates HTTP response bodies against configured rules.
 * Supports: 'contains' (substring), 'regex' (pattern match), 'json_path' (dot-path extraction).
 */

import { createChildLogger } from '../core/index.js';
import type { BodyValidation } from '../core/index.js';

const log = createChildLogger('BodyValidator');

export interface ValidationResult {
  valid: boolean;
  errorMessage: string | null;
}

/**
 * Validate a response body against the configured validation rule.
 */
export function validateBody(body: string, rule: BodyValidation): ValidationResult {
  switch (rule.type) {
    case 'contains':
      return validateContains(body, rule.expression);
    case 'regex':
      return validateRegex(body, rule.expression);
    case 'json_path':
      return validateJsonPath(body, rule.expression, rule.expectedValue);
    default:
      return { valid: false, errorMessage: `Unknown validation type: ${(rule as BodyValidation).type}` };
  }
}

function validateContains(body: string, substring: string): ValidationResult {
  if (body.includes(substring)) {
    return { valid: true, errorMessage: null };
  }
  return {
    valid: false,
    errorMessage: `Response body does not contain expected string: "${substring}"`,
  };
}

function validateRegex(body: string, pattern: string): ValidationResult {
  try {
    const regex = new RegExp(pattern);
    if (regex.test(body)) {
      return { valid: true, errorMessage: null };
    }
    return {
      valid: false,
      errorMessage: `Response body does not match pattern: /${pattern}/`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ pattern, error: msg }, 'Invalid regex pattern');
    return {
      valid: false,
      errorMessage: `Invalid regex pattern: ${msg}`,
    };
  }
}

function validateJsonPath(body: string, path: string, expectedValue?: string): ValidationResult {
  try {
    const parsed = JSON.parse(body);
    const value = extractJsonPath(parsed, path);

    if (value === undefined) {
      return {
        valid: false,
        errorMessage: `JSON path "${path}" not found in response`,
      };
    }

    // If no expected value, just check that the path exists
    if (expectedValue === undefined) {
      return { valid: true, errorMessage: null };
    }

    const actualStr = String(value);
    if (actualStr === expectedValue) {
      return { valid: true, errorMessage: null };
    }

    return {
      valid: false,
      errorMessage: `JSON path "${path}" = "${actualStr}", expected "${expectedValue}"`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      valid: false,
      errorMessage: `Failed to parse response as JSON: ${msg}`,
    };
  }
}

/**
 * Extract a value from a JSON object using dot-notation path.
 * Supports array indexing: "data.items.0.name"
 */
function extractJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    if (typeof current === 'object') {
      // Try numeric index for arrays
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
