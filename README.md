# StatusOwl

Open-source service health monitor and public status page.

## Overview

StatusOwl monitors HTTP endpoints, tracks incidents, displays uptime history, and sends webhook alerts. Built as a real-world dogfood project for [Overlord v2](https://github.com/twitchyvr/Overlord-v2) — the AI agent orchestration platform.

## Features (Planned)

- **Endpoint Monitoring**: HTTP/HTTPS health checks with configurable intervals
- **Incident Tracking**: Automatic incident creation on failures, manual incident management
- **Public Status Page**: Embeddable status page showing real-time service health
- **Uptime History**: 90-day uptime percentages, response time graphs
- **Webhook Alerts**: Slack, Discord, email, and custom webhook notifications
- **Team Management**: Multi-user access with role-based permissions
- **API**: RESTful API for programmatic access to all features

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: SQLite (via better-sqlite3) for simplicity, PostgreSQL-ready
- **Frontend**: Vanilla JS + CSS (lightweight, no framework)
- **Monitoring Engine**: Built-in scheduler with configurable check intervals
- **Notifications**: Webhook-based alert system

## Architecture

```
src/
  core/           # Config, logger, contracts
  monitors/       # Health check engine, scheduler
  incidents/      # Incident detection & management
  notifications/  # Alert channels (Slack, Discord, email, webhooks)
  api/            # Express REST API
  storage/        # SQLite database layer
  status-page/    # Public status page generator
public/
  index.html      # Status page frontend
  css/            # Styles
  js/             # Client-side JS
```

## Development

```bash
npm install
npm run dev      # Start development server
npm test         # Run tests
npm run build    # Build for production
```

## License

MIT
