# Changelog

All notable changes to StatusOwl are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] — 2026-03-13

### Added
- **Webhook Retry + Dead Letter Queue** — Exponential backoff retry (1s/2s/4s/8s/16s ±25% jitter), max 5 attempts, automatic DLQ for permanently failed deliveries, manual retry from DLQ (#67)
- **Assertions DSL** — Multi-condition health check assertions: status_code, response_time, header_exists, header_equals, body_contains, body_not_contains, body_json_path, body_regex — with configurable severity levels (critical/warning/info) (#68)
- **Status Badges** — Shields.io-style SVG badges for service status, embeddable HTML widget with auto-refresh (#69)
- **Health Score + SLA Tracking** — Weighted health score calculation (uptime 40%, response time 30%, consistency 20%, recent trend 10%), per-service SLA targets with compliance monitoring (#70)
- **Uptime History Calendar** — GitHub-style contribution calendar showing daily uptime levels (down/degraded/partial/good/great), SVG grid rendering (#71)
- **SSE Event Stream** — Server-Sent Events for real-time status updates, EventBus singleton with subscribe/unsubscribe, keepalive, event replay via Last-Event-ID (#72)
- API routes: `/api/badges/:id`, `/api/badges/:id/embed`, `/api/calendar/:id`, `/api/calendar/:id/svg`, `/api/sla-targets`, `/api/sla-targets/:id`, `/api/services/:id/health-score`, `/api/services/:id/sla-compliance`, `/api/events/stream`, `/api/webhooks/:id/deliveries`, `/api/webhooks/:id/dead-letters`, `/api/webhook-deliveries/:id/retry`
- Database migrations #11 (webhook_deliveries + webhook_dead_letters tables), #12 (assertions column on services), #13 (sla_targets table)
- Status page: live SSE indicator, uptime calendar section
- 606 tests across 34 modules (174 new tests)

## [0.5.0] — 2026-03-13

### Added
- **Audit Log** — Full audit trail for all mutation endpoints: service/group/incident/maintenance/alert policy/auth operations (#64)
- **Service Dependencies** — Dependency graph with cycle detection, downstream cascade discovery, parent/child relationship management (#65)
- **Custom Branding** — Configurable status page branding: logo URL, primary/accent colors, favicon, with `/api/branding` endpoint (#62)
- **Incident Subscriptions** — Email subscription system with confirmation tokens, per-service or global subscriptions, unsubscribe flow (#63)
- **Scheduled Reports** — Daily/weekly uptime report generation with background scheduler, per-service stats, overall uptime aggregation (#61)
- **Multi-Region Monitoring** — Region-based health checks with regional latency tracking, default region seeding (#60)
- API routes: `/api/audit-log`, `/api/branding`, `/api/subscriptions`, `/api/subscriptions/confirm/:token`, `/api/subscriptions/unsubscribe/:token`, `/api/reports`, `/api/reports/:id`, `/api/reports/generate`, `/api/services/:id/dependencies`, `/api/services/:id/dependents`, `/api/services/:id/downstream`, `/api/dependencies/:id`
- Database migrations #6 (audit_log table), #7 (service_dependencies table), #8 (subscriptions table), #9 (uptime_reports table), #10 (monitoring_regions table + region_id on check_results)
- Branding config env vars: `STATUSOWL_LOGO_URL`, `STATUSOWL_PRIMARY_COLOR`, `STATUSOWL_ACCENT_COLOR`, `STATUSOWL_FAVICON_URL`
- Report scheduler: daily generation on startup + 24h interval, weekly on Mondays
- Audit logging wired into all mutation routes (services, groups, incidents, maintenance, alert policies, auth)
- 432 tests across 28 modules (73 new tests)

## [0.4.0] — 2026-03-13

### Added
- **GNAP Authorization Protocol** — RFC 9635 compliant auth: client registration, token grants, introspection, revocation, rotation, scope-based middleware (#53)
- **TCP Health Checks** — Port connectivity checks with timeout, supports `tcp://host:port` format (#55)
- **DNS Health Checks** — Domain resolution checks with optional expected address validation (#55)
- **Configurable Alert Policies** — Per-service failure thresholds, response time alerts, cooldown periods (#56)
- **Cursor-based API Pagination** — `/api/v2/services` and `/api/v2/incidents` with filtering (#57)
- **Email Notification Channel** — SMTP transport, HTML/plain text templates, multi-recipient support (#54)
- **Status Page: SSL Badges** — Color-coded lock icons showing certificate validity and expiry (#58)
- **Status Page: Response Time Sparklines** — Inline SVG charts showing p50/p95 over 24h (#58)
- **Status Page: Maintenance Banners** — Yellow alert banner for active maintenance windows (#58)
- **Status Page: Group Organization** — Services rendered within API-sourced groups (#58)
- GNAP API routes: `/api/auth/register`, `/api/auth/grant`, `/api/auth/introspect`, `/api/auth/revoke`, `/api/auth/rotate`
- Alert policy API routes: `/api/alert-policies` (CRUD), `/api/services/:id/alert-policy`
- `checkType` field on services (`http`, `tcp`, `dns`) with scheduler dispatch
- Database migrations #4 (`check_type` column) and #5 (`alert_policies`, `alert_cooldowns` tables)
- SMTP configuration env vars: `STATUSOWL_SMTP_HOST`, `STATUSOWL_SMTP_PORT`, `STATUSOWL_SMTP_USER`, `STATUSOWL_SMTP_PASS`, `STATUSOWL_EMAIL_FROM`, `STATUSOWL_EMAIL_TO`
- 358 tests across 22 modules (133 new tests)

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
