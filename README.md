# Kampi.fun

Mobile-first HTML5 platform for lightweight 1v1 games with server-authoritative matches, virtual chips, and embeddable game clients.

## Requirements

- **Node.js 22** recommended (see `.nvmrc`; Node 20 may work locally with the Colyseus postinstall patch)
- **pnpm 9.15.4** (`corepack enable`)
- **Docker** for local PostgreSQL and Redis

After `pnpm install`, a postinstall script patches `@colyseus/greeting-banner` for Colyseus 0.16 compatibility on Node 20.

## Quick start

```bash
# 1. Clone and enter the repo
cd Kampi

# 2. Environment
cp .env.example .env

# 3. Infrastructure
docker compose up -d

# 4. Install dependencies
corepack enable
pnpm install

# 5. Database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 6. Start all services
pnpm dev
```

## Services

| Service | URL | Health |
|---------|-----|--------|
| Web platform | http://localhost:3000 | — |
| Admin shell | http://localhost:3001 | — |
| API | http://localhost:4000 | `/health/live`, `/health/ready` |
| Realtime | ws://localhost:2567 | `/health/live`, `/health/ready` |
| RPS game | http://localhost:5173 | `/health/live` (nginx in Docker) |

OpenAPI (development): http://localhost:4000/docs

## Development auth

Local seed creates a dev player with **10,000 chips**.

```
Bearer dev-guest-token-kampi-local-only
```

Guest login (development only): `POST /auth/guest`

## Play RPS locally against a bot

1. Start the stack (`pnpm dev`).
2. Open http://localhost:5173 (or launch from http://localhost:3000).
3. Tap **Find Match** — waits up to 10s for a real opponent, then a bot fills in.
4. Play best-of-three; server resolves rounds and pays the winner once.

## Root commands

```bash
pnpm dev          # all apps (turbo parallel)
pnpm build        # production builds
pnpm lint         # ESLint
pnpm typecheck    # TypeScript
pnpm test         # Vitest
pnpm format       # Prettier write
pnpm db:generate  # Prisma client
pnpm db:migrate   # apply migrations
pnpm db:seed      # seed data
```

## Monorepo layout

```text
apps/web, apps/admin, apps/api, apps/realtime, apps/game-rps
packages/contracts, database, domain, game-sdk, config
```

See `docs/architecture.md` and `AGENTS.md` for engineering conventions.

## Prototype economy defaults

| Setting | Value |
|---------|-------|
| Starting balance | 10,000 chips |
| RPS entry fee | 500 chips |
| Winner payout | 950 chips |
| Format | Best of 3 |
| Bot fallback | 10 seconds |
| Reconnect grace | 30 seconds |

All values are configurable via environment variables.

## License

Private commercial project — no open-source license included.
