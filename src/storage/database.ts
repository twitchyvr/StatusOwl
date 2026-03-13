/**
 * StatusOwl — Database
 *
 * SQLite via better-sqlite3 with schema migrations.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfig, createChildLogger } from '../core/index.js';

const log = createChildLogger('Database');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const config = getConfig();

  // Ensure data directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  log.info({ path: config.dbPath }, 'Database connected');

  runMigrations(_db);

  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  const version = currentVersion?.v ?? 0;

  const migrations: Array<{ version: number; sql: string }> = [
    {
      version: 1,
      sql: `
        -- Service groups
        CREATE TABLE IF NOT EXISTS service_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          collapsed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Monitored services
        CREATE TABLE IF NOT EXISTS services (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT 'GET',
          expected_status INTEGER NOT NULL DEFAULT 200,
          check_interval INTEGER NOT NULL DEFAULT 60,
          timeout INTEGER NOT NULL DEFAULT 10,
          headers TEXT,
          body TEXT,
          status TEXT NOT NULL DEFAULT 'unknown',
          enabled INTEGER NOT NULL DEFAULT 1,
          group_id TEXT REFERENCES service_groups(id) ON DELETE SET NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Health check results
        CREATE TABLE IF NOT EXISTS check_results (
          id TEXT PRIMARY KEY,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          response_time REAL NOT NULL,
          status_code INTEGER,
          error_message TEXT,
          checked_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_check_results_service ON check_results(service_id, checked_at DESC);

        -- Incidents
        CREATE TABLE IF NOT EXISTS incidents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'minor',
          status TEXT NOT NULL DEFAULT 'investigating',
          message TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT
        );

        -- Incident to Service junction
        CREATE TABLE IF NOT EXISTS incident_services (
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          PRIMARY KEY (incident_id, service_id)
        );

        -- Incident updates (timeline)
        CREATE TABLE IF NOT EXISTS incident_updates (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_incident_updates ON incident_updates(incident_id, created_at DESC);

        -- Webhook subscribers
        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          secret TEXT,
          events TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Daily uptime aggregates (for fast 90-day queries)
        CREATE TABLE IF NOT EXISTS uptime_daily (
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          total_checks INTEGER NOT NULL DEFAULT 0,
          successful_checks INTEGER NOT NULL DEFAULT 0,
          avg_response_time REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (service_id, date)
        );
      `,
    },
    {
      version: 2,
      sql: `
        -- Maintenance windows
        CREATE TABLE IF NOT EXISTS maintenance_windows (
          id TEXT PRIMARY KEY,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_maintenance_windows_service ON maintenance_windows(service_id, start_at, end_at);

        -- Body validation config on services
        ALTER TABLE services ADD COLUMN body_validation TEXT;
      `,
    },
    {
      version: 3,
      sql: `
        -- SSL certificate check results
        CREATE TABLE IF NOT EXISTS ssl_checks (
          id TEXT PRIMARY KEY,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          valid INTEGER NOT NULL DEFAULT 0,
          valid_from TEXT NOT NULL DEFAULT '',
          valid_to TEXT NOT NULL DEFAULT '',
          issuer TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          days_until_expiry INTEGER NOT NULL DEFAULT -1,
          error_message TEXT,
          checked_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ssl_checks_service ON ssl_checks(service_id, checked_at DESC);

        -- Response time percentile buckets (hourly)
        CREATE TABLE IF NOT EXISTS response_time_buckets (
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          hour TEXT NOT NULL,
          p50 REAL NOT NULL DEFAULT 0,
          p95 REAL NOT NULL DEFAULT 0,
          p99 REAL NOT NULL DEFAULT 0,
          min REAL NOT NULL DEFAULT 0,
          max REAL NOT NULL DEFAULT 0,
          sample_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (service_id, hour)
        );
      `,
    },
    {
      version: 4,
      sql: `
        ALTER TABLE services ADD COLUMN check_type TEXT NOT NULL DEFAULT 'http';
      `,
    },
    {
      version: 5,
      sql: `
        CREATE TABLE IF NOT EXISTS alert_policies (
          id TEXT PRIMARY KEY,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          failure_threshold INTEGER NOT NULL DEFAULT 3,
          response_time_threshold_ms REAL,
          cooldown_minutes INTEGER NOT NULL DEFAULT 30,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_policies_service ON alert_policies(service_id);

        CREATE TABLE IF NOT EXISTS alert_cooldowns (
          service_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
          last_alert_at TEXT NOT NULL
        );
      `,
    },
    {
      version: 6,
      sql: `
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT 'system',
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
      `,
    },
    {
      version: 7,
      sql: `
        CREATE TABLE IF NOT EXISTS service_dependencies (
          id TEXT PRIMARY KEY,
          parent_service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          child_service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(parent_service_id, child_service_id)
        );
        CREATE INDEX IF NOT EXISTS idx_deps_parent ON service_dependencies(parent_service_id);
        CREATE INDEX IF NOT EXISTS idx_deps_child ON service_dependencies(child_service_id);
      `,
    },
    {
      version: 8,
      sql: `
        CREATE TABLE IF NOT EXISTS subscriptions (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
          confirmed INTEGER NOT NULL DEFAULT 0,
          confirm_token TEXT NOT NULL,
          unsubscribe_token TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_service ON subscriptions(service_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique ON subscriptions(email, service_id);
      `,
    },
    {
      version: 9,
      sql: `
        CREATE TABLE IF NOT EXISTS uptime_reports (
          id TEXT PRIMARY KEY,
          period TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}',
          generated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_reports_period ON uptime_reports(period, start_date DESC);
      `,
    },
    {
      version: 10,
      sql: `
        CREATE TABLE IF NOT EXISTS monitoring_regions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          location TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1
        );

        -- Add region_id to check_results
        ALTER TABLE check_results ADD COLUMN region_id TEXT DEFAULT 'default';

        -- Seed default region
        INSERT OR IGNORE INTO monitoring_regions (id, name, location, enabled) VALUES ('default', 'Default', 'Local', 1);
      `,
    },
    {
      version: 11,
      sql: `
        -- Webhook delivery tracking with retry support
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY,
          webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'dead')),
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          last_attempt_at TEXT,
          next_retry_at TEXT,
          response_status INTEGER,
          response_body TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status, next_retry_at);

        -- Dead letter queue for permanently failed deliveries
        CREATE TABLE IF NOT EXISTS webhook_dead_letters (
          id TEXT PRIMARY KEY,
          delivery_id TEXT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
          webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_webhook ON webhook_dead_letters(webhook_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_delivery ON webhook_dead_letters(delivery_id);
      `,
    },
    {
      version: 12,
      sql: `
        -- Assertions DSL: multi-condition health check assertions stored as JSON array
        ALTER TABLE services ADD COLUMN assertions TEXT;
      `,
    },
    {
      version: 13,
      sql: `
        -- SLA targets per service
        CREATE TABLE IF NOT EXISTS sla_targets (
          id TEXT PRIMARY KEY,
          service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          uptime_target REAL NOT NULL,
          response_time_target REAL NOT NULL,
          evaluation_period TEXT NOT NULL DEFAULT 'monthly',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_targets_service ON sla_targets(service_id);
      `,
    },
  ];

  const applyMigration = db.transaction((m: { version: number; sql: string }) => {
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    log.info({ version: m.version }, 'Applied migration');
  });

  for (const m of migrations) {
    if (m.version > version) {
      applyMigration(m);
    }
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    log.info('Database closed');
  }
}
