/**
 * Config Tests
 * 
 * Tests for configuration defaults and loading.
 */

import { describe, it, expect } from 'vitest';
import { getConfig } from '../src/core/config.js';

describe('Config', () => {
  // These tests verify the config module works correctly
  // The setup.ts already loads config with :memory: and error log level

  it('should return a valid config object', () => {
    const config = getConfig();
    
    // Config should have all required fields
    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('host');
    expect(config).toHaveProperty('dbPath');
    expect(config).toHaveProperty('logLevel');
    expect(config).toHaveProperty('defaultCheckInterval');
    expect(config).toHaveProperty('defaultTimeout');
    expect(config).toHaveProperty('maxRetries');
    expect(config).toHaveProperty('siteName');
    expect(config).toHaveProperty('siteDescription');
    expect(config).toHaveProperty('webhookRetries');
    expect(config).toHaveProperty('webhookBackoffMs');
  });

  it('should have valid log level', () => {
    const config = getConfig();
    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    expect(validLevels).toContain(config.logLevel);
  });

  it('should have numeric port', () => {
    const config = getConfig();
    expect(typeof config.port).toBe('number');
    expect(config.port).toBeGreaterThan(0);
  });

  it('should have valid timeout values', () => {
    const config = getConfig();
    expect(config.defaultCheckInterval).toBeGreaterThan(0);
    expect(config.defaultTimeout).toBeGreaterThan(0);
    expect(config.maxRetries).toBeGreaterThan(0);
  });

  it('should have valid webhook retry settings', () => {
    const config = getConfig();
    expect(config.webhookRetries).toBeGreaterThanOrEqual(0);
    expect(config.webhookBackoffMs).toBeGreaterThanOrEqual(0);
  });

  it('should return same instance on repeated calls', () => {
    const config1 = getConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2);
  });
});
