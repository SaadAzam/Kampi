# Kampi.fun — AGENTS.md

## Project

Kampi.fun is a private commercial HTML5 platform for lightweight 1v1 games. This monorepo contains the web shell, admin shell, HTTP API, authoritative realtime server, game clients, and shared packages.

## Node & tooling

- **Node.js:** 22 (see `.nvmrc`)
- **Package manager:** pnpm 9.15.4 (pinned in `package.json`)
- **Task runner:** Turborepo

## Repository layout

```text
apps/web          Next.js platform shell + PWA
apps/admin        Minimal Next.js admin shell
apps/api          NestJS HTTP API
apps/realtime     Colyseus authoritative match server
apps/game-rps     Vite + Phaser RPS client
apps/game-penalty Vite + Phaser Penalty Duel client
apps/e2e          Playwright / live matchmaking checks
packages/contracts     Shared Zod schemas and types
packages/database      Prisma schema and client
packages/domain        Server-only wallet/match services
packages/game-sdk      Modular game SDK (common/client/server/embed/testing)
packages/game-rps-core RPS manifest + schemas
packages/game-penalty  Penalty Duel pure rules
packages/config        Shared TS/ESLint/Prettier config
```

**Rule:** Apps may import packages. Apps must **never** import from other apps.

## Trust boundaries

- All game outcomes, timers, payouts and match finalization are **server-authoritative**.
- Clients submit intentions only (e.g. `submit_choice`).
- Never trust client-provided balances, match results or payout amounts.
- Chips are integers (`BigInt` in DB, strings in JSON APIs).
- Wallet ledger entries are immutable; use idempotency keys for all financial mutations.

## Local development

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Services:

| Service   | URL                      |
|-----------|--------------------------|
| Web       | http://localhost:3000    |
| Admin     | http://localhost:3001    |
| API       | http://localhost:4000    |
| Realtime  | ws://localhost:2567      |
| RPS game  | http://localhost:5173    |
| Penalty   | http://localhost:5174    |

Dev guest token (local only, single-player): `dev-guest-token-kampi-local-only`. For two-player tests use `POST /auth/guest` / **New guest identity**.

## Commands

```bash
pnpm dev          # all apps in parallel
pnpm build        # production build
pnpm lint         # ESLint
pnpm typecheck    # TypeScript
pnpm test         # Vitest
pnpm test:e2e     # Playwright (stack must be running)
pnpm format       # Prettier
pnpm db:generate  # Prisma client
pnpm db:migrate   # apply migrations
pnpm db:seed      # seed games + dev player
```

## Environment

All services validate required env vars at startup via Zod schemas in `@kampi/contracts`. See `.env.example`.

`DEV_GUEST_AUTH_ENABLED` is automatically treated as disabled in production unless explicitly enabled.

## Testing expectations

- Unit tests for RPS resolution, wallet idempotency, embed SDK validation
- CI runs lint, typecheck, test, build with Postgres + Redis service containers
- Do not disable core checks to make builds pass

## Out of scope (this phase)

- Real-money gaming, KYC/AML, cash-out
- Payment provider integration (Stripe/Apple/Google) — interface only
- Production admin auth
- Final art/audio
- Capacitor/native wrappers

## Documentation

See `docs/` for architecture, local setup, Railway deployment, embedding SDK, and open client decisions.
