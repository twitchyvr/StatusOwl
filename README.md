# StatusOwl

Open-source service health monitor and public status page.

## Overview

StatusOwl monitors HTTP endpoints, tracks incidents, displays uptime history, and sends webhook alerts. Built as a real-world dogfood project for [Overlord v2](https://github.com/twitchyvr/Overlord-v2) — the AI agent orchestration platform.

## Features

- **Multi-Protocol Monitoring** — HTTP/HTTPS, TCP port, and DNS resolution health checks
- **Body Validation** — Response body assertions: substring match, regex, JSON path extraction
- **SSL Certificate Monitoring** — TLS certificate expiry tracking with warning/critical alert levels
- **Response Time Percentiles** — Hourly p50/p95/p99 aggregation for latency analysis
- **GNAP Authorization** — RFC 9635 compliant auth with token grants, scopes, rotation, and introspection
- **Configurable Alert Policies** — Per-service failure thresholds, response time alerts, cooldown periods
- **Automatic Incident Detection** — Creates incidents based on alert policy thresholds, auto-resolves on recovery
- **Maintenance Windows** — Scheduled maintenance periods that suppress incident detection
- **Service Groups** — Organize services into logical groups for the status page
- **Incident Timeline** — Full audit trail with status progression (investigating → identified → monitoring → resolved)
- **Public Status Page** — SSL badges, response time sparklines, maintenance banners, group organization
- **Uptime Tracking** — 90-day daily uptime history with aggregation background job
- **Notification Channels** — Email (SMTP), Slack (Block Kit), Discord (rich embeds), webhooks (HMAC-SHA256)
- **Audit Log** — Full audit trail for all mutation endpoints with filtering and pagination
- **Service Dependencies** — Dependency graph with cycle detection and downstream cascade discovery
- **Custom Branding** — Configurable status page: logo, colors, favicon via API and env vars
- **Incident Subscriptions** — Email subscription system with confirmation tokens, per-service or global
- **Scheduled Reports** — Daily/weekly uptime report generation with background scheduler
- **Multi-Region Monitoring** — Region-based health checks with regional latency tracking
- **Webhook Retry + Dead Letter Queue** — Exponential backoff retry with jitter, automatic DLQ for permanently failed deliveries
- **Assertions DSL** — Multi-condition health check assertions: status_code, response_time, header/body checks with severity levels
- **Status Badges** — Shields.io-style SVG badges and embeddable HTML widget with auto-refresh
- **Health Score + SLA Tracking** — Weighted health score calculation, per-service SLA targets with compliance monitoring
- **Uptime History Calendar** — GitHub-style contribution calendar showing daily uptime levels
- **SSE Event Stream** — Server-Sent Events for real-time status page updates with event replay
- **Paginated API** — Cursor-based pagination with filtering on `/api/v2/` endpoints
- **RESTful API** — Full CRUD for services, groups, incidents, maintenance windows, alert policies, and auth
- **Graceful Shutdown** — Proper signal handling, scheduler cleanup, database close

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| HTTP | Express |
| Database | SQLite (better-sqlite3) with WAL mode |
| Validation | Zod schemas |
| Logging | Pino (structured JSON) |
| Frontend | Vanilla JS + CSS (no framework) |

## Architecture

```
src/
  core/            # Config (Zod), logger (Pino), contracts (Result pattern, types)
  storage/         # SQLite database, service-repo, check-repo, group-repo, ssl-repo, dependency-repo
  monitors/        # Health checker, scheduler, SSL checker, body validator, percentile/daily aggregators
  incidents/       # Incident repo, auto-detector (configurable thresholds)
  alerts/          # Alert policy repo, cooldown management
  maintenance/     # Maintenance window repo, active window detection
  auth/            # GNAP authorization (RFC 9635), token management
  audit/           # Audit log repository, query and purge operations
  subscriptions/   # Incident subscription repo, confirm/unsubscribe token flow
  reports/         # Uptime report generator, daily/weekly scheduler
  notifications/   # Webhook repo + delivery retry/DLQ, Slack/Discord/Email formatters, event dispatcher
  sla/             # SLA targets, health score calculation, compliance monitoring
  api/             # Express REST routes, badges, calendar, SSE event stream, embed widget
  status-page/     # Public HTML/CSS/JS status page
  server.ts        # Entry point
```

### Key Patterns

- **Result pattern** — All module I/O returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`
- **Zod validation** — Request schemas validated at API boundary
- **Structured logging** — Pino with child loggers per module
- **Auto-scheduling** — Services scheduled on creation, rescheduled on update, unscheduled on delete

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (auto-reload)
npm run dev

# Open status page
open http://localhost:3000

# Create a service
curl -X POST http://localhost:3000/api/services \
  -H 'Content-Type: application/json' \
  -d '{"name": "My API", "url": "https://api.example.com"}'
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| **Services** | | |
| GET | `/api/services` | List all services |
| POST | `/api/services` | Create a service |
| GET | `/api/services/:id` | Get service by ID |
| PATCH | `/api/services/:id` | Update a service |
| DELETE | `/api/services/:id` | Delete a service |
| **Monitoring** | | |
| GET | `/api/services/:id/checks` | Recent health check results |
| GET | `/api/services/:id/uptime?period=90d` | Uptime summary (24h/7d/30d/90d) |
| GET | `/api/services/:id/uptime/history?days=90` | Daily uptime history |
| GET | `/api/services/:id/ssl` | Latest SSL certificate check |
| GET | `/api/services/:id/ssl/history` | SSL check history |
| GET | `/api/services/:id/percentiles?hours=24` | Response time percentiles |
| **Groups** | | |
| GET | `/api/groups` | List service groups |
| POST | `/api/groups` | Create a group |
| GET | `/api/groups/:id` | Get group by ID |
| PATCH | `/api/groups/:id` | Update a group |
| DELETE | `/api/groups/:id` | Delete a group |
| **Incidents** | | |
| GET | `/api/services/:id/incidents` | Incidents for a service |
| GET | `/api/status` | Public status overview |
| GET | `/api/incidents` | Open incidents with timelines |
| GET | `/api/incidents/:id` | Incident detail with timeline |
| POST | `/api/incidents/:id/update` | Add timeline update |
| **Maintenance** | | |
| GET | `/api/maintenance-windows` | List maintenance windows |
| POST | `/api/maintenance-windows` | Create a maintenance window |
| GET | `/api/maintenance-windows/:id` | Get window by ID |
| DELETE | `/api/maintenance-windows/:id` | Delete a maintenance window |
| **Alert Policies** | | |
| GET | `/api/alert-policies` | List all alert policies |
| POST | `/api/alert-policies` | Create an alert policy |
| GET | `/api/alert-policies/:id` | Get policy by ID |
| PATCH | `/api/alert-policies/:id` | Update a policy |
| DELETE | `/api/alert-policies/:id` | Delete a policy |
| GET | `/api/services/:id/alert-policy` | Get policy for a service |
| **GNAP Auth** | | |
| POST | `/api/auth/register` | Register a GNAP client |
| POST | `/api/auth/grant` | Request an access token |
| POST | `/api/auth/introspect` | Introspect a token |
| POST | `/api/auth/revoke` | Revoke a token |
| POST | `/api/auth/rotate` | Rotate a token |
| **Audit Log** | | |
| GET | `/api/audit-log` | Query audit log with filtering |
| **Branding** | | |
| GET | `/api/branding` | Public branding configuration |
| **Dependencies** | | |
| GET | `/api/services/:id/dependencies` | Dependencies of a service |
| GET | `/api/services/:id/dependents` | Services that depend on a service |
| GET | `/api/services/:id/downstream` | All downstream services (recursive) |
| POST | `/api/services/:id/dependencies` | Add a dependency |
| DELETE | `/api/dependencies/:id` | Remove a dependency |
| **Subscriptions** | | |
| POST | `/api/subscriptions` | Subscribe to incident notifications |
| GET | `/api/subscriptions/confirm/:token` | Confirm a subscription |
| GET | `/api/subscriptions/unsubscribe/:token` | Unsubscribe |
| GET | `/api/subscriptions` | List all subscriptions (admin) |
| DELETE | `/api/subscriptions/:id` | Delete a subscription (admin) |
| **Reports** | | |
| GET | `/api/reports` | List generated reports |
| GET | `/api/reports/:id` | Get a specific report |
| POST | `/api/reports/generate` | Generate a report on demand |
| **Webhook Deliveries** | | |
| GET | `/api/webhooks/:id/deliveries` | Delivery history for a webhook |
| GET | `/api/webhooks/:id/dead-letters` | Dead letter queue entries |
| POST | `/api/webhook-deliveries/:id/retry` | Retry a dead-lettered delivery |
| **Badges & Embeds** | | |
| GET | `/api/badges/:id` | SVG status badge for a service |
| GET | `/api/badges/:id/embed` | Embeddable HTML status widget |
| **Calendar** | | |
| GET | `/api/calendar/:id` | Uptime calendar data (JSON) |
| GET | `/api/calendar/:id/svg` | Uptime calendar (SVG) |
| **SLA** | | |
| GET | `/api/sla-targets` | List all SLA targets |
| POST | `/api/sla-targets` | Create an SLA target |
| GET | `/api/sla-targets/:id` | Get SLA target by ID |
| PATCH | `/api/sla-targets/:id` | Update an SLA target |
| DELETE | `/api/sla-targets/:id` | Delete an SLA target |
| GET | `/api/services/:id/health-score` | Calculate health score |
| GET | `/api/services/:id/sla-compliance` | SLA compliance report |
| **Events** | | |
| GET | `/api/events/stream` | SSE event stream (real-time) |
| **Paginated (v2)** | | |
| GET | `/api/v2/services` | Paginated services with filtering |
| GET | `/api/v2/incidents` | Paginated incidents with filtering |

## Configuration

All settings via environment variables with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/statusowl.db` | SQLite database path |
| `LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error/fatal) |
| `CHECK_INTERVAL` | `60` | Default check interval (seconds) |
| `CHECK_TIMEOUT` | `10` | Default check timeout (seconds) |
| `MAX_RETRIES` | `3` | Max check retries |
| `SITE_NAME` | `StatusOwl` | Status page title |
| `SITE_DESCRIPTION` | `Service Status` | Status page subtitle |
| `STATUSOWL_API_KEY` | — | API key for mutation endpoints |
| `STATUSOWL_SLACK_WEBHOOK` | — | Slack incoming webhook URL |
| `STATUSOWL_DISCORD_WEBHOOK` | — | Discord webhook URL |
| `STATUSOWL_SMTP_HOST` | — | SMTP server hostname |
| `STATUSOWL_SMTP_PORT` | `587` | SMTP server port |
| `STATUSOWL_SMTP_USER` | — | SMTP username |
| `STATUSOWL_SMTP_PASS` | — | SMTP password |
| `STATUSOWL_EMAIL_FROM` | — | Sender email address |
| `STATUSOWL_EMAIL_TO` | — | Recipient emails (comma-separated) |
| `STATUSOWL_LOGO_URL` | — | Status page logo URL |
| `STATUSOWL_PRIMARY_COLOR` | `#2563eb` | Status page primary color |
| `STATUSOWL_ACCENT_COLOR` | `#059669` | Status page accent color |
| `STATUSOWL_FAVICON_URL` | — | Status page favicon URL |

## Scripts

```bash
npm run dev        # Development server with hot reload (tsx watch)
npm run build      # TypeScript compilation
npm start          # Production server (requires build)
npm test           # Run vitest test suite
npm run typecheck  # Type checking without emit
npm run lint       # ESLint
```

## License

MIT
