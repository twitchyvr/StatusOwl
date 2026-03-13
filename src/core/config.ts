/**
 * StatusOwl — Configuration
 *
 * Reads from environment variables with sensible defaults.
 */

import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  dbPath: z.string().default('./data/statusowl.db'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // API Authentication
  apiKey: z.string().optional(),

  // Monitoring defaults
  defaultCheckInterval: z.coerce.number().default(60), // seconds
  defaultTimeout: z.coerce.number().default(10),       // seconds
  maxRetries: z.coerce.number().default(3),

  // Status page
  siteName: z.string().default('StatusOwl'),
  siteDescription: z.string().default('Service Status'),

  // Webhook alerts
  webhookRetries: z.coerce.number().default(3),
  webhookBackoffMs: z.coerce.number().default(1000),

  // External notifications
  slackWebhook: z.string().url().optional(),
  discordWebhook: z.string().url().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  _config = ConfigSchema.parse({
    port: process.env.PORT,
    host: process.env.HOST,
    dbPath: process.env.DB_PATH,
    logLevel: process.env.LOG_LEVEL,
    apiKey: process.env.STATUSOWL_API_KEY,
    defaultCheckInterval: process.env.CHECK_INTERVAL,
    defaultTimeout: process.env.CHECK_TIMEOUT,
    maxRetries: process.env.MAX_RETRIES,
    siteName: process.env.SITE_NAME,
    siteDescription: process.env.SITE_DESCRIPTION,
    webhookRetries: process.env.WEBHOOK_RETRIES,
    webhookBackoffMs: process.env.WEBHOOK_BACKOFF_MS,
    slackWebhook: process.env.STATUSOWL_SLACK_WEBHOOK,
    discordWebhook: process.env.STATUSOWL_DISCORD_WEBHOOK,
  });

  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}
