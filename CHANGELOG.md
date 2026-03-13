# Changelog

All notable changes to StatusOwl are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] — 2026-03-13

### Added
- **Service Groups API** — CRUD for organizing services into logical groups (#47)
- **Maintenance Windows** — Scheduled maintenance periods that suppress incident detection (#46)
- **Body Validation** — Response body assertions: substring, regex, JSON path extraction (#48)
- **Uptime History** — Daily uptime aggregation with 90-day history endpoint (#49)
- **SSL Certificate Monitoring** — TLS certificate extraction, expiry tracking, alert levels (#50)
- **Response Time Percentiles** — Hourly p50/p95/p99 aggregation with background job (#51)
- API routes: `/api/groups`, `/api/maintenance-windows`, `/api/services/:id/ssl`, `/api/services/:id/ssl/history`, `/api/services/:id/percentiles`, `/api/services/:id/uptime/history`
- Database migration #2: `maintenance_windows` table, `body_validation` column on services
- Database migration #3: `ssl_checks` table, `response_time_buckets` table
- Background aggregators: daily uptime (24h cycle), hourly percentiles (1h cycle)
- 225 tests across 16 modules (72 new tests)

## [0.2.0] — 2026-03-13

### Added
- Core foundation: config (Zod schema), logger (Pino), contracts (Result pattern, types)
- SQLite database with schema migrations (better-sqlite3, WAL mode)
- Service CRUD: create, read, update, delete with Zod validation
- Health check engine: HTTP checker with configurable timeout and expected status
- Monitor scheduler: per-service intervals, auto-schedule on create/update
- Check result recording and uptime summary (24h/7d/30d/90d)
- Incident repository: CRUD with service junction and timeline entries
- Incident detector: auto-creates incidents after 3 consecutive failures, auto-resolves on recovery
- Webhook notification system: HMAC-SHA256 signed delivery with 10s timeout
- REST API: full CRUD for services, checks, uptime, incidents, status
- Public status page: real-time service status, uptime percentages, incident timeline
- Graceful shutdown: SIGINT/SIGTERM handling, scheduler stop, database close
- Vitest test suite: 69 tests across 7 modules (config, service-repo, check-repo, incident-repo, incident-detector, checker, auth)
- API key authentication middleware: Bearer header and X-API-Key support, dev mode bypass
- GitHub Actions CI/CD pipeline: install → type-check → lint → test
- ESLint with @typescript-eslint for src/ and tests/
- GitHub issue templates (bug report, feature request) and PR template
- Slack notification channel: Block Kit formatted messages with severity color coding
- Discord notification channel: rich embeds with severity, status, and affected services fields
- Notification dispatcher: parallel delivery to all configured channels (Slack, Discord)
- Config support for `STATUSOWL_SLACK_WEBHOOK` and `STATUSOWL_DISCORD_WEBHOOK` env vars
- `getServicesByIds()` helper for affected service lookup in notifications
- Status page dark mode with CSS custom properties and toggle button
- Status page service groups with collapsible headers
- Status page 90-day uptime history bars with tooltip drill-down
- Status page incident timeline with severity-colored indicators
- Status page auto-refresh with configurable interval
- Status page responsive layout for mobile and desktop
- Notification test suite: 22 tests for Slack and Discord formatters
- Status page DOM tests for dark mode, groups, uptime bars, and timeline
- Docker dev container (devcontainer.json + docker-compose.yml) and production Dockerfile
- Vitest test suite expanded to 153 tests across 12 modules

### Fixed
- Status page uptime field mismatch (`uptime` → `uptimePercent`) causing TypeError crash
- Null guard in uptime display (`!== null` → `!= null`) to catch both null and undefined
- Incident detector not wired into scheduler — now runs after every health check
- Incidents list endpoint missing timeline data — now included per incident
- Check query ordering nondeterministic when timestamps collide — added ROWID tiebreaker
- Service `enabled` field defaults to `false` when omitted — now defaults to `true`

## [0.1.0] — 2026-03-13

### Added
- Initial project scaffold: package.json, tsconfig.json, directory structure
- Core modules: config.ts, logger.ts, contracts.ts with Zod schemas
- Database layer: SQLite migrations, service-repo, check-repo
- Express server with health endpoint and graceful shutdown
