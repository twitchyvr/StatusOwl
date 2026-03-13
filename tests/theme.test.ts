/**
 * Theme Tests
 *
 * Tests for:
 * 1. Theme CSS variable coverage (light/dark have matching vars)
 * 2. Theme toggle logic (localStorage persistence, OS detection)
 * 3. Theme API endpoint tests (GET /api/theme, PATCH /api/theme)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── CSS Variable Coverage Tests ──

describe('Theme CSS Variables', () => {
  const themeCssPath = path.resolve(__dirname, '../src/status-page/theme.css');
  const statusCssPath = path.resolve(__dirname, '../src/status-page/status.css');
  let themeCss: string;
  let statusCss: string;

  beforeEach(() => {
    themeCss = fs.readFileSync(themeCssPath, 'utf-8');
    statusCss = fs.readFileSync(statusCssPath, 'utf-8');
  });

  /**
   * Extract all CSS custom property declarations (--name: value) from a block
   * identified by a selector string. Uses brace counting to handle nested blocks.
   */
  function extractVariables(css: string, selectorLiteral: string): Set<string> {
    const vars = new Set<string>();

    // Find the selector in the raw CSS text
    let searchFrom = 0;
    while (true) {
      const idx = css.indexOf(selectorLiteral, searchFrom);
      if (idx === -1) break;

      // Find the opening brace after the selector
      const openBrace = css.indexOf('{', idx);
      if (openBrace === -1) break;

      // Walk forward counting braces to find the matching close
      let depth = 1;
      let pos = openBrace + 1;
      while (pos < css.length && depth > 0) {
        if (css[pos] === '{') depth++;
        else if (css[pos] === '}') depth--;
        pos++;
      }

      const block = css.slice(openBrace + 1, pos - 1);

      // Extract custom property declarations
      const varRegex = /(--[\w-]+)\s*:/g;
      let varMatch: RegExpExecArray | null;
      while ((varMatch = varRegex.exec(block)) !== null) {
        vars.add(varMatch[1]);
      }

      searchFrom = pos;
    }

    return vars;
  }

  it('should define :root (light) variables in theme.css', () => {
    const lightVars = extractVariables(themeCss, ':root');
    expect(lightVars.size).toBeGreaterThan(0);
    // Core variables must exist
    expect(lightVars.has('--color-background')).toBe(true);
    expect(lightVars.has('--color-surface')).toBe(true);
    expect(lightVars.has('--color-text-primary')).toBe(true);
    expect(lightVars.has('--color-text-secondary')).toBe(true);
    expect(lightVars.has('--color-border')).toBe(true);
    expect(lightVars.has('--color-shadow')).toBe(true);
  });

  it('should define [data-theme="dark"] variables in theme.css', () => {
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');
    expect(darkVars.size).toBeGreaterThan(0);
    expect(darkVars.has('--color-background')).toBe(true);
    expect(darkVars.has('--color-surface')).toBe(true);
    expect(darkVars.has('--color-text-primary')).toBe(true);
    expect(darkVars.has('--color-text-secondary')).toBe(true);
    expect(darkVars.has('--color-border')).toBe(true);
    expect(darkVars.has('--color-shadow')).toBe(true);
  });

  it('should have matching color variables between light and dark themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    // Every color variable in light should have a dark counterpart
    const lightColorVars = [...lightVars].filter((v) => v.startsWith('--color-'));
    const darkColorVars = [...darkVars].filter((v) => v.startsWith('--color-'));

    for (const v of lightColorVars) {
      expect(darkColorVars).toContain(v);
    }
  });

  it('should define status colors in both themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    const statusVars = [
      '--color-operational',
      '--color-degraded',
      '--color-partial-outage',
      '--color-outage',
      '--color-maintenance',
    ];

    for (const v of statusVars) {
      expect(lightVars.has(v)).toBe(true);
      expect(darkVars.has(v)).toBe(true);
    }
  });

  it('should define severity badge colors in both themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    const severityVars = [
      '--color-severity-minor-bg',
      '--color-severity-minor-text',
      '--color-severity-major-bg',
      '--color-severity-major-text',
      '--color-severity-critical-bg',
      '--color-severity-critical-text',
    ];

    for (const v of severityVars) {
      expect(lightVars.has(v)).toBe(true);
      expect(darkVars.has(v)).toBe(true);
    }
  });

  it('should define calendar heat-map colors in both themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    for (let level = 0; level <= 4; level++) {
      const varName = `--color-calendar-level-${level}`;
      expect(lightVars.has(varName)).toBe(true);
      expect(darkVars.has(varName)).toBe(true);
    }
  });

  it('should define SSE indicator colors in both themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    expect(lightVars.has('--color-sse-connected')).toBe(true);
    expect(lightVars.has('--color-sse-disconnected')).toBe(true);
    expect(darkVars.has('--color-sse-connected')).toBe(true);
    expect(darkVars.has('--color-sse-disconnected')).toBe(true);
  });

  it('should define maintenance banner colors in both themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    const bannerVars = [
      '--color-maintenance-banner-bg',
      '--color-maintenance-banner-border',
      '--color-maintenance-banner-text',
      '--color-maintenance-banner-icon',
    ];

    for (const v of bannerVars) {
      expect(lightVars.has(v)).toBe(true);
      expect(darkVars.has(v)).toBe(true);
    }
  });

  it('should define resolved badge colors in both themes', () => {
    const lightVars = extractVariables(themeCss, ':root');
    const darkVars = extractVariables(themeCss, '[data-theme="dark"]');

    expect(lightVars.has('--color-resolved-badge-bg')).toBe(true);
    expect(lightVars.has('--color-resolved-badge-text')).toBe(true);
    expect(darkVars.has('--color-resolved-badge-bg')).toBe(true);
    expect(darkVars.has('--color-resolved-badge-text')).toBe(true);
  });

  it('should NOT have hardcoded hex colors in status.css', () => {
    // Strip CSS comments first
    const noComments = statusCss.replace(/\/\*[\s\S]*?\*\//g, '');
    // Find any remaining #hex values that are NOT inside var() fallbacks
    // We allow fallback values like var(--foo, #abc) — those are fine
    const lines = noComments.split('\n');
    const hardcodedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and lines that are just closing braces
      if (!trimmed || trimmed === '}' || trimmed === '{') continue;
      // Skip lines that are CSS custom property declarations (--name: #hex)
      if (/^\s*--[\w-]+\s*:/.test(trimmed)) continue;
      // Check for hardcoded hex colors
      if (/#[0-9a-fA-F]{3,8}\b/.test(trimmed)) {
        hardcodedLines.push(trimmed);
      }
    }

    expect(hardcodedLines).toEqual([]);
  });

  it('should include smooth theme transition rules', () => {
    expect(themeCss).toContain('transition: background-color 0.3s');
    expect(themeCss).toContain('color 0.3s');
    expect(themeCss).toContain('border-color 0.3s');
  });

  it('should respect prefers-reduced-motion', () => {
    expect(themeCss).toContain('prefers-reduced-motion: reduce');
    expect(themeCss).toContain('transition: none');
  });
});

// ── Theme Toggle Logic Tests ──

describe('Theme Toggle Logic (status.js)', () => {
  const statusJsPath = path.resolve(__dirname, '../src/status-page/status.js');
  let statusJs: string;

  beforeEach(() => {
    statusJs = fs.readFileSync(statusJsPath, 'utf-8');
  });

  it('should define THEME_KEY for localStorage persistence', () => {
    expect(statusJs).toContain("THEME_KEY = 'statusowl-theme'");
  });

  it('should have getThemePreference function that checks localStorage', () => {
    expect(statusJs).toContain('function getThemePreference()');
    expect(statusJs).toContain('localStorage.getItem(THEME_KEY)');
  });

  it('should detect OS dark mode preference via matchMedia', () => {
    expect(statusJs).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  it('should have applyTheme function that sets data-theme attribute', () => {
    expect(statusJs).toContain('function applyTheme(theme)');
    expect(statusJs).toContain("setAttribute('data-theme'");
  });

  it('should persist theme choice to localStorage', () => {
    expect(statusJs).toContain('localStorage.setItem(THEME_KEY, theme)');
  });

  it('should have toggleTheme function', () => {
    expect(statusJs).toContain('function toggleTheme()');
  });

  it('should listen for OS theme changes', () => {
    expect(statusJs).toContain("addEventListener('change'");
    // Verify it passes through to the handler
    expect(statusJs).toContain('mediaQueryListener');
  });

  it('should update aria-pressed on theme toggle for accessibility', () => {
    expect(statusJs).toContain("setAttribute('aria-pressed'");
  });

  it('should read calendar colors from CSS custom properties', () => {
    expect(statusJs).toContain('getCalendarColors()');
    expect(statusJs).toContain("getPropertyValue('--color-calendar-level-");
  });

  it('should initialize theme on page load', () => {
    expect(statusJs).toContain('initTheme()');
  });
});

// ── Theme API Tests ──

// Mock all dependencies that routes.ts and theme-config.ts import
vi.mock('../src/storage/index.js', () => ({
  createService: vi.fn(),
  getService: vi.fn(),
  listServices: vi.fn(),
  listServicesPaginated: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  getRecentChecks: vi.fn(),
  getUptimeSummary: vi.fn(),
  getDailyHistory: vi.fn(),
  getLatestSslCheck: vi.fn(),
  getSslHistory: vi.fn(),
  createGroup: vi.fn(),
  getGroup: vi.fn(),
  listGroups: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  getDependenciesOf: vi.fn(),
  getDependentsOn: vi.fn(),
  getDownstreamServices: vi.fn(),
}));

vi.mock('../src/monitors/index.js', () => ({
  scheduleService: vi.fn(),
  unscheduleService: vi.fn(),
}));

vi.mock('../src/monitors/percentile-aggregator.js', () => ({
  getPercentiles: vi.fn(),
}));

vi.mock('../src/incidents/index.js', () => ({
  getOpenIncidents: vi.fn(),
  getIncidentById: vi.fn(),
  getIncidentsByService: vi.fn(),
  updateIncidentStatus: vi.fn(),
}));

vi.mock('../src/maintenance/index.js', () => ({
  createMaintenanceWindow: vi.fn(),
  getMaintenanceWindow: vi.fn(),
  listMaintenanceWindows: vi.fn(),
  deleteMaintenanceWindow: vi.fn(),
}));

vi.mock('../src/alerts/index.js', () => ({
  createAlertPolicy: vi.fn(),
  getAlertPolicy: vi.fn(),
  getAlertPolicyByService: vi.fn(),
  listAlertPolicies: vi.fn(),
  updateAlertPolicy: vi.fn(),
  deleteAlertPolicy: vi.fn(),
}));

vi.mock('../src/auth/index.js', () => ({
  registerClient: vi.fn(),
  requestGrant: vi.fn(),
  introspectToken: vi.fn(),
  revokeToken: vi.fn(),
  rotateToken: vi.fn(),
}));

vi.mock('../src/audit/index.js', () => ({
  recordAudit: vi.fn(() => ({ ok: true, data: {} })),
  queryAuditLog: vi.fn(),
}));

vi.mock('../src/subscriptions/index.js', () => ({
  createSubscription: vi.fn(),
  confirmSubscription: vi.fn(),
  unsubscribe: vi.fn(),
  listSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
}));

// Mock database — use a real in-memory map for config table
const configStore = new Map<string, string>();

vi.mock('../src/storage/database.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS config')) {
        return { run: vi.fn() };
      }
      if (sql.includes('SELECT value FROM config WHERE key = ?')) {
        return {
          get: vi.fn((key: string) => {
            const val = configStore.get(key);
            return val ? { value: val } : undefined;
          }),
        };
      }
      if (sql.includes('INSERT INTO config')) {
        return {
          run: vi.fn((_key: string, value: string) => {
            // Extract key from the INSERT — it is the first param
            configStore.set(_key, value);
          }),
        };
      }
      // Default fallback for other queries (from routes.ts mocks)
      return {
        all: vi.fn(() => []),
        get: vi.fn(() => ({ count: 0 })),
        run: vi.fn(),
      };
    }),
  })),
  closeDb: vi.fn(),
}));

vi.mock('../src/api/auth.js', () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { themeRouter } from '../src/api/theme-config.js';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(themeRouter);
  return app;
}

describe('Theme API', () => {
  let app: express.Express;

  beforeEach(() => {
    configStore.clear();
    app = buildApp();
  });

  describe('GET /api/theme', () => {
    it('should return 200 with default theme config', async () => {
      const res = await request(app).get('/api/theme');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('should return system as the default theme', async () => {
      const res = await request(app).get('/api/theme');
      expect(res.body.data.defaultTheme).toBe('system');
    });

    it('should return allowUserToggle as true by default', async () => {
      const res = await request(app).get('/api/theme');
      expect(res.body.data.allowUserToggle).toBe(true);
    });

    it('should return all expected fields', async () => {
      const res = await request(app).get('/api/theme');
      const data = res.body.data;

      expect(data).toHaveProperty('defaultTheme');
      expect(data).toHaveProperty('allowUserToggle');
    });
  });

  describe('PATCH /api/theme', () => {
    it('should update the default theme to dark', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({ defaultTheme: 'dark' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.defaultTheme).toBe('dark');
    });

    it('should update the default theme to light', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({ defaultTheme: 'light' });

      expect(res.status).toBe(200);
      expect(res.body.data.defaultTheme).toBe('light');
    });

    it('should update allowUserToggle', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({ allowUserToggle: false });

      expect(res.status).toBe(200);
      expect(res.body.data.allowUserToggle).toBe(false);
    });

    it('should reject invalid theme values', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({ defaultTheme: 'neon' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('should reject invalid allowUserToggle values', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({ allowUserToggle: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('should accept partial updates', async () => {
      // First set dark theme
      await request(app)
        .patch('/api/theme')
        .send({ defaultTheme: 'dark' });

      // Then only update toggle, theme should persist
      const res = await request(app)
        .patch('/api/theme')
        .send({ allowUserToggle: false });

      expect(res.status).toBe(200);
      expect(res.body.data.defaultTheme).toBe('dark');
      expect(res.body.data.allowUserToggle).toBe(false);
    });

    it('should accept custom color overrides', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({
          customLightColors: {
            '--color-background': '#ffffff',
            '--color-surface': '#f0f0f0',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customLightColors).toBeDefined();
      expect(res.body.data.customLightColors['--color-background']).toBe('#ffffff');
    });

    it('should accept empty body without error', async () => {
      const res = await request(app)
        .patch('/api/theme')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('Persistence', () => {
    it('should persist config changes across reads', async () => {
      // Update
      await request(app)
        .patch('/api/theme')
        .send({ defaultTheme: 'dark', allowUserToggle: false });

      // Read back
      const res = await request(app).get('/api/theme');
      expect(res.body.data.defaultTheme).toBe('dark');
      expect(res.body.data.allowUserToggle).toBe(false);
    });
  });
});

// ── index.html Tests ──

describe('index.html Theme Integration', () => {
  const indexHtmlPath = path.resolve(__dirname, '../src/status-page/index.html');
  let indexHtml: string;

  beforeEach(() => {
    indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
  });

  it('should include theme.css stylesheet', () => {
    expect(indexHtml).toContain('href="theme.css"');
  });

  it('should include theme.css BEFORE status.css', () => {
    const themeIndex = indexHtml.indexOf('theme.css');
    const statusIndex = indexHtml.indexOf('status.css');
    expect(themeIndex).toBeLessThan(statusIndex);
  });

  it('should have a theme toggle button', () => {
    expect(indexHtml).toContain('id="theme-toggle"');
  });

  it('should have aria-label on theme toggle', () => {
    expect(indexHtml).toContain('aria-label="Toggle dark mode"');
  });

  it('should have aria-pressed on theme toggle', () => {
    expect(indexHtml).toContain('aria-pressed=');
  });

  it('should have sun and moon SVG icons', () => {
    expect(indexHtml).toContain('class="sun-icon"');
    expect(indexHtml).toContain('class="moon-icon"');
  });

  it('should have theme-color meta tags for light and dark', () => {
    expect(indexHtml).toContain('name="theme-color"');
    expect(indexHtml).toContain('prefers-color-scheme: light');
    expect(indexHtml).toContain('prefers-color-scheme: dark');
  });
});
