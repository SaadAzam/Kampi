# Local development

## Prerequisites

- Node.js 22 (`nvm use`)
- pnpm 9 (`corepack enable`)
- Docker Desktop or compatible runtime

## Setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Verify infrastructure:

```bash
docker compose ps
curl http://localhost:4000/health/ready
curl http://localhost:2567/health/ready
```

## Run services

All apps:

```bash
pnpm dev
```

Individual apps:

```bash
pnpm --filter @kampi/api dev
pnpm --filter @kampi/realtime dev
pnpm --filter @kampi/web dev
pnpm --filter @kampi/admin dev
pnpm --filter @kampi/game-rps dev
```

## Environment

Copy `.env.example` to `.env` at the repo root. Services load it from the monorepo root (API/realtime use `dotenv` with `../../.env`).

Required variables are validated at startup — missing values produce a clear error.

## Dev player

Seed output includes:

- Player ID (fixed dev UUID)
- Token: `dev-guest-token-kampi-local-only`
- Balance: 10,000 chips

## Database workflows

```bash
pnpm db:generate   # after schema changes
pnpm db:migrate    # apply migrations
pnpm db:seed       # idempotent seed
```

Create a new migration during development:

```bash
pnpm --filter @kampi/database db:migrate:dev
```

## Testing

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| API env validation fails | `.env` exists and `JWT_SECRET` ≥ 32 chars |
| Realtime won't start | Redis running on 6379 |
| Prisma errors | `pnpm db:generate` after schema edits |
| Bot never joins | `BOT_FILL_AFTER_MS` in `.env`, realtime logs |
