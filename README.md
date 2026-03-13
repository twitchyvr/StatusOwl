# StatusOwl

Open-source service health monitor and public status page.

## Overview

StatusOwl monitors HTTP endpoints, tracks incidents, displays uptime history, and sends webhook alerts. Built as a real-world dogfood project for [Overlord v2](https://github.com/twitchyvr/Overlord-v2) — the AI agent orchestration platform.

## Features

- **Endpoint Monitoring** — HTTP/HTTPS health checks with configurable intervals, timeouts, and expected status codes
- **Body Validation** — Response body assertions: substring match, regex, JSON path extraction
- **SSL Certificate Monitoring** — TLS certificate expiry tracking with warning/critical alert levels
- **Response Time Percentiles** — Hourly p50/p95/p99 aggregation for latency analysis
- **Automatic Incident Detection** — Creates incidents after 3 consecutive failures, auto-resolves on recovery
- **Maintenance Windows** — Scheduled maintenance periods that suppress incident detection
- **Service Groups** — Organize services into logical groups for the status page
- **Incident Timeline** — Full audit trail with status progression (investigating → identified → monitoring → resolved)
- **Public Status Page** — Real-time service status, uptime percentages, incident timeline
- **Uptime Tracking** — 90-day daily uptime history with aggregation background job
- **Webhook Alerts** — HMAC-SHA256 signed webhook delivery with retry and timeout
- **Notification Channels** — Slack (Block Kit) and Discord (rich embeds) integration
- **RESTful API** — Full CRUD for services, groups, incidents, maintenance windows, and monitoring data
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
  storage/         # SQLite database, service-repo, check-repo, group-repo, ssl-repo
  monitors/        # Health checker, scheduler, SSL checker, body validator, percentile/daily aggregators
  incidents/       # Incident repo, auto-detector (3-failure threshold)
  maintenance/     # Maintenance window repo, active window detection
  notifications/   # Webhook repo, Slack/Discord formatters, event dispatcher
  api/             # Express REST routes with rate limiting + auth
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
