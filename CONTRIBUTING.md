# Contributing to StatusOwl

## Development Setup

```bash
git clone https://github.com/twitchyvr/StatusOwl.git
cd StatusOwl
npm install
npm run dev
```

The server starts at `http://localhost:3000` with hot reload.

## Branch Strategy

| Branch | Purpose | Merges To |
|--------|---------|-----------|
| `main` | Stable, protected | — |
| `feat/*` | New features | `main` (via PR) |
| `fix/*` | Bug fixes | `main` (via PR) |
| `docs/*` | Documentation | `main` (via PR) |
| `refactor/*` | Code restructuring | `main` (via PR) |

## Commit Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

Body explaining what and why.

Co-Authored-By: Your Name <email>
Closes #<issue-number>
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`

**Scopes**: `core`, `storage`, `monitors`, `incidents`, `notifications`, `api`, `status-page`

## Pull Request Process

1. Create a GitHub Issue for the work
2. Branch from `main`: `feat/short-description` or `fix/short-description`
3. Make changes, commit atomically
4. Open a PR with:
   - Summary of changes
   - Test plan
   - Link to issue (`Closes #N`)
5. Ensure CI passes (lint, typecheck, tests)
6. Get review approval before merging

## Code Style

- TypeScript strict mode
- Zod schemas for runtime validation
- Result pattern for all module I/O (`ok(data)` / `err(code, message)`)
- Pino structured logging with child loggers per module
- `.js` extensions in import paths (Node16 module resolution)
- No `any` types without justification

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
npm run typecheck  # Type checking
npm run lint       # Linting
```

## Architecture Rules

- All source code in `src/` as TypeScript
- Static assets for status page in `src/status-page/`
- Database migrations in `src/storage/database.ts`
- API routes in `src/api/routes.ts`
- Entry point is `src/server.ts`
