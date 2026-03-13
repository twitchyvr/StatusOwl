/**
 * StatusOwl — Theme Configuration API
 *
 * Provides server-side default theme configuration.
 * GET  /api/theme — returns current default theme config (public)
 * PATCH /api/theme — updates default theme config (admin, requires auth)
 *
 * Theme preferences are stored in the SQLite config table.
 * The status page reads these on load to set the initial theme before
 * the user's localStorage preference takes over.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createChildLogger, ok, err } from '../core/index.js';
import type { Result } from '../core/index.js';
import { getDb } from '../storage/database.js';
import { requireAuth } from './auth.js';
import { recordAudit } from '../audit/index.js';

const log = createChildLogger('ThemeConfig');

// ── Schema ──

const ThemeMode = z.enum(['light', 'dark', 'system']);
type ThemeMode = z.infer<typeof ThemeMode>;

const ThemeConfigSchema = z.object({
  defaultTheme: ThemeMode,
  allowUserToggle: z.boolean(),
  customLightColors: z.record(z.string()).optional(),
  customDarkColors: z.record(z.string()).optional(),
});

type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

const ThemeConfigUpdateSchema = ThemeConfigSchema.partial();

// ── Default values ──

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  defaultTheme: 'system',
  allowUserToggle: true,
  customLightColors: undefined,
  customDarkColors: undefined,
};

// ── Config table key ──

const CONFIG_KEY = 'theme_config';

// ── Storage helpers ──

function ensureConfigTable(): void {
  const db = getDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ).run();
}

function getThemeConfig(): Result<ThemeConfig> {
  try {
    ensureConfigTable();
    const db = getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(CONFIG_KEY) as
      | { value: string }
      | undefined;

    if (!row) {
      return ok(DEFAULT_THEME_CONFIG);
    }

    const parsed = ThemeConfigSchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) {
      log.warn({ error: parsed.error.message }, 'Invalid theme config in DB, returning defaults');
      return ok(DEFAULT_THEME_CONFIG);
    }

    return ok(parsed.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to read theme config');
    return err('DB_ERROR', msg);
  }
}

function updateThemeConfig(updates: Partial<ThemeConfig>): Result<ThemeConfig> {
  try {
    ensureConfigTable();

    // Read current config
    const currentResult = getThemeConfig();
    if (!currentResult.ok) return currentResult;

    const merged: ThemeConfig = {
      ...currentResult.data,
      ...updates,
    };

    // Validate the merged config
    const parsed = ThemeConfigSchema.safeParse(merged);
    if (!parsed.success) {
      return err('VALIDATION', parsed.error.message);
    }

    const db = getDb();
    db.prepare(
      'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(CONFIG_KEY, JSON.stringify(parsed.data));

    log.info({ config: parsed.data }, 'Theme config updated');
    return ok(parsed.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg }, 'Failed to update theme config');
    return err('DB_ERROR', msg);
  }
}

// ── Router ──

export const themeRouter = Router();

/**
 * GET /api/theme — returns current default theme configuration (public).
 */
themeRouter.get('/api/theme', (_req: Request, res: Response) => {
  const result = getThemeConfig();
  if (!result.ok) {
    return res.status(500).json(result);
  }
  res.json(result);
});

/**
 * PATCH /api/theme — update default theme configuration (admin).
 */
themeRouter.patch('/api/theme', requireAuth, (req: Request, res: Response) => {
  const parsed = ThemeConfigUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.message },
    });
  }

  const result: Result<ThemeConfig> = updateThemeConfig(parsed.data);
  if (!result.ok) {
    const httpStatus = result.error.code === 'VALIDATION' ? 400 : 500;
    return res.status(httpStatus).json(result);
  }

  recordAudit('config.update', 'config', CONFIG_KEY, {
    detail: `Theme config updated: defaultTheme=${result.data.defaultTheme}`,
  });
  res.json(result);
});

// ── Exports for testing ──

export { getThemeConfig, updateThemeConfig, ThemeConfig, ThemeMode, DEFAULT_THEME_CONFIG };
