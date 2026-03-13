/**
 * StatusOwl — Logger
 *
 * Structured logging via pino.
 */

import pino from 'pino';
import { getConfig } from './config.js';

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (_logger) return _logger;

  const config = getConfig();

  _logger = pino({
    level: config.logLevel,
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });

  return _logger;
}

export function createChildLogger(name: string): pino.Logger {
  return getLogger().child({ module: name });
}
