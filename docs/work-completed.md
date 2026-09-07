# Kampi.fun — everything completed so far

**Written:** Monday 7 September 2026  
**Branch:** `main` (tracks `origin/main`)  
**Committed HEAD:** `26a3ba6` — *Bug fixes when starting a new instance and old one doesnt cleanly*  
**Remote:** `https://github.com/SaadAzam/Kampi.git`  
**This document** is a full inventory of the platform from kickoff through the current working tree, including **uncommitted** auth, progression, stats, Docker, and lobby work that has not been pushed to GitHub yet.

Prior incremental snapshots:

- `.kampi-progress-reports/REPORT-01-2026-09-02.md` — monorepo bootstrap + RPS vertical slice
- `.kampi-progress-reports/REPORT-02-2026-09-02.md` — Game SDK + Penalty Duel

This file is the combined picture, not a delta.

---

## 1. What Kampi.fun is

Kampi.fun is a **private commercial** mobile-first HTML5 platform for lightweight **1v1 games**. Players use **virtual chips** (not real money). Matches, timers, outcomes, and payouts are **server-authoritative**. Game clients render state and submit intentions only.

The product is a TypeScript monorepo: a Next.js PWA lobby, a NestJS HTTP API, a Colyseus realtime match server, two Phaser game clients, a minimal admin shell, and shared packages for contracts, database, domain logic, and a modular game SDK.

**Launch titles in this phase**

| Game | Slug | Client | Port | Format |
|------|------|--------|------|--------|
| Rock Paper Scissors | `rock-paper-scissors` | `apps/game-rps` | 5173 | Best of 3 |
| Penalty Duel (Goal Kicks) | `penalty-duel` | `apps/game-penalty` | 5174 | 3 kicks each + sudden death |

---

## 2. Timeline

| When | Commit / slice | What landed |
|------|----------------|-------------|
| 1 Sep 2026 | `a5409d1` *Initial commit of the Kampi.fun monorepo.* | Full foundation: pnpm + Turborepo, Prisma schema, NestJS API, Colyseus RPS, Next.js web/admin, embedding SDK, Docker Compose, CI, docs. Local vertical slice: queue → bot fill → best-of-3 RPS → one authoritative payout. |
| 2 Sep 2026 | `4e94bac` *restart all apis* | `pnpm dev:reset`, Colyseus greeting shim, API tsconfig / DI fixes so the local stack restarts cleanly. |
| 2 Sep 2026 | `0bf069f` *Penalty 1v1 initial implementation* | Modular `@kampi/game-sdk`, `@kampi/game-rps-core`, `@kampi/game-penalty`, Penalty Phaser client, multi-game lobby, private invites, Playwright two-player E2E. |
| 3 Sep 2026 | `26a3ba6` *Bug fixes when starting a new instance…* | Stale-instance / unclean restart fixes. |
| 5–7 Sep 2026 | **Uncommitted on `main`** | Email/password auth, guest claim, XP/level/leaderboards, stats API, match-outcome persistence, lobby UI for auth + progression, Dockerfiles for Railway-style deploys, Penalty nginx image. |

Engineering convention from kickoff: **the agent does not commit or push**. Review and git history stay with the repo owner.

---

## 3. Tooling and repository layout

- **Node.js:** 22 (`.nvmrc`). Engines field requires `>=22.0.0`. Node 20 can run locally with the Colyseus greeting postinstall patch.
- **Package manager:** pnpm **9.15.4** (pinned; `corepack enable`).
- **Task runner:** Turborepo (`turbo.json` — `build` depends on `^build`; `dev` is persistent and uncached).
- **Language:** TypeScript strict mode with `noUncheckedIndexedAccess`. No `any`.
- **Rule:** apps import packages only. Apps **never** import other apps.

```text
apps/web              Next.js platform shell + PWA (port 3000)
apps/admin            Minimal Next.js admin shell (port 3001)
apps/api              NestJS HTTP API (port 4000)
apps/realtime         Colyseus authoritative match server (ws 2567)
apps/game-rps         Vite + Phaser RPS client (port 5173)
apps/game-penalty     Vite + Phaser Penalty Duel client (port 5174)
apps/e2e              Playwright + live Colyseus matchmaking checks

packages/contracts    Shared Zod schemas, env parsing, RPS helpers
packages/database     Prisma schema, client, migrations, seed
packages/domain       Server-only wallet, auth, players, progression
packages/game-sdk     Modular SDK: common / client / server / embed / testing
packages/game-rps-core  RPS manifest + command schemas (pure)
packages/game-penalty   Penalty Duel rules (pure)
packages/config       Shared TS / ESLint / Prettier

docs/                 Architecture, ADRs, local/Railway, SDK, games
scripts/              dev reset, Colyseus patch, nginx PORT rewrite
.github/workflows/ci.yml
docker-compose.yml    Postgres 16 + Redis 7 only
```

Workspace: `apps/*` and `packages/*` (`pnpm-workspace.yaml`).

---

## 4. Architecture and trust model

```text
Browser
  ├─ Web PWA (lobby, auth, catalog, iframe host)
  ├─ Admin shell (dev-only pages)
  ├─ RPS client / Penalty client (Phaser)
  └─ Optional third-party iframe host
        │
        ├─ HTTP  → NestJS API → PostgreSQL
        └─ WS    → Colyseus   → PostgreSQL + Redis
```

| Concern | Owner |
|---------|--------|
| Match state, timers, round resolution | Realtime (Colyseus rooms) |
| Entry fee, payout, refund | `@kampi/domain` + PostgreSQL transactions |
| XP, wins/losses, leaderboards | `@kampi/domain` `recordMatchOutcome` after settlement |
| Balances shown to clients | API (read-only) |
| Player moves | Client → realtime as **intentions** (`submit_choice` / `submit_action`) |

Clients never compute winners, payouts, or valid-move acceptance. Chips are integers (`BigInt` in DB, strings in JSON). Ledger rows are immutable. Every wallet mutation uses a unique idempotency key.

**Match lifecycle**

```text
WAITING → ACTIVE → RESOLVING → FINISHED
                       ↘ ABORTED (refund)
```

1. Authenticated player joins the lobby queue (public or private invite).
2. Two humans match immediately, or a bot fills after `BOT_FILL_AFTER_MS` on public queues.
3. Entry fees are deducted in a transaction before `ACTIVE`.
4. Server runs rounds; hidden actions stay in server memory until both lock or timeout.
5. Winner receives **one** idempotent payout (`payoutLedgerKey` unique).
6. Disconnect within `RECONNECT_GRACE_MS` can restore via Colyseus reconnection token.
7. After payout, rooms call `persistMatchOutcome` so progression and leaderboards update once.

**ADRs**

- `docs/adr/001-server-authoritative-realtime.md` — Colyseus; clients send intentions only.
- `docs/adr/002-bigint-wallet-ledger.md` — BigInt chips, append-only ledger, idempotency keys.

---

## 5. Data model (PostgreSQL / Prisma)

**Migrations**

| Migration | Purpose |
|-----------|---------|
| `20260901085800_init` | Full initial schema |
| `20260905183000_auth_and_progression_fk` *(uncommitted)* | `User.passwordHash`; `PlayerProgression.gameId` FK + index |

**Enums:** `UserStatus`, `SessionStatus`, `WalletLedgerType`, `PurchaseStatus`, `PurchaseProvider`, `GameStatus`, `MatchStatus`, `MatchPlayerKind`, `MatchPlayerResult`, `MatchmakingTicketStatus`, `MatchEventType`, `AuditAction`.

**Models**

| Model | Role |
|-------|------|
| `User` | Identity. Optional `email` (unique), optional `passwordHash` (scrypt), `isGuest`, `displayName`, status. |
| `Session` | Bearer sessions. Stores **SHA-256 of the token**, never the raw token. TTL + `ACTIVE` / `REVOKED` / `EXPIRED`. |
| `Wallet` | One per user. `balance` is `BigInt`. |
| `WalletLedgerEntry` | Append-only. Unique `idempotencyKey`. Optional `matchId` / `purchaseId`. |
| `Purchase` | Pending/completed chip credit. Providers: Stripe / Apple / Google / MANUAL. **No live payment integration.** |
| `Game` / `GameVersion` | Catalog. Active version `config` JSON holds fees, timeouts, `clientLaunchUrl`. |
| `Match` | Room id, fees, payout keys, winner, abort reason, metadata. Unique `payoutLedgerKey` and `abortRefundKey`. |
| `MatchPlayer` | Seat/slot, HUMAN/BOT, score, result, unique `entryFeeKey`. |
| `MatchEvent` | Audit trail of created / joined / round / finished / reconnect, JSON payload. |
| `MatchmakingTicket` | Queued / matched / cancelled / expired. |
| `PlayerProgression` | Per user × game: xp, level, wins, losses, draws. Unique `(userId, gameId)`. |
| `LeaderboardEntry` | Per game × user × `periodKey` (`weekly:YYYY-Www` or `all-time`). Score = win count. |
| `AuditLog` | `USER_CREATED`, `SESSION_CREATED`, `WALLET_MUTATION`, `MATCH_FINALIZED`, `PURCHASE_CREATED`, `ADMIN_ACTION`. |

**Ledger types:** `STARTING_BALANCE`, `MATCH_ENTRY`, `MATCH_REFUND`, `MATCH_PAYOUT`, `PURCHASE_CREDIT`, `ADMIN_ADJUSTMENT`.

**Where the database lives today:** local Docker Postgres 16 (`kampi-postgres`, `localhost:5432`, db/user `kampi`). Redis 7 (`kampi-redis`, `6379`) for Colyseus presence and private-invite TTL. Railway PostgreSQL/Redis are documented, not provisioned.

---

## 6. Economy (prototype defaults)

All values come from environment variables (see `.env.example`).

| Setting | Default |
|---------|---------|
| Starting balance | 10,000 chips |
| RPS entry fee | 500 |
| RPS winner payout | 950 (house keeps 50 of the 1,000 pot) |
| Penalty entry fee | 500 (seed / version config) |
| Penalty winner payout | 950 |
| Bot fill delay | 10,000 ms |
| Reconnect grace | 30,000 ms |

Chips never leave the platform. There is no cash-out, KYC, or real-money path in this phase. `PurchaseProvider` + `ManualPurchaseProvider` exist as an interface for a later payments phase.

**Progression XP (uncommitted domain rules)**

| Result | XP |
|--------|----|
| Win | 50 |
| Draw | 25 |
| Loss | 15 |
| Abort | 0 |

Level = `1 + floor(xp / 100)`. Leaderboards count **wins** weekly (ISO week key `weekly:YYYY-Www`) and all-time. Bots do not get progression rows.

---

## 7. Shared packages

### 7.1 `@kampi/contracts`

Zod schemas and types consumed by API, realtime, web, and tests.

- **Env:** `ApiEnvSchema`, `RealtimeEnvSchema`, `parseEnv`. `JWT_SECRET` ≥ 32 chars. `DEV_GUEST_AUTH_ENABLED` defaults off; production treats it as off unless explicitly `true`.
- **Auth *(uncommitted)*:** `RegisterRequestSchema`, `LoginRequestSchema`, `ClaimAccountRequestSchema`, `AuthUserSchema`, `AuthSessionResponseSchema`. Email lowercased; password 8–128 chars; display name 2–32.
- **Stats *(uncommitted)*:** leaderboard query (`weekly` / `all-time`, limit 1–100), player stats, per-game progression, ranked entries.
- **RPS:** choice resolution, conceal-until-lock, match-complete helper, RNG.
- **Embed:** protocol `1.0.0`, host↔game discriminated unions.
- **Realtime:** legacy client/server message unions (queue, choice, snapshots).
- **Common:** economy config, chip string helpers.

Tests: `rps.test.ts`, `auth.test.ts`.

### 7.2 `@kampi/database`

Prisma client with `native` + `linux-musl-openssl-3.0.x` binaries (Docker/Alpine). Seed (`packages/database/prisma/seed.ts`):

- Upserts **Rock Paper Scissors** `1.0.0` and **Penalty Duel** `1.0.0` with fees, timeouts, `clientLaunchUrl`.
- Upserts fixed dev guest `dev-player@kampi.local` / id `00000000-0000-4000-8000-000000000001` with 10,000 chips and token `dev-guest-token-kampi-local-only`.

Seed is idempotent (ledger key `seed:dev-player:starting-balance`).

### 7.3 `@kampi/domain` (server-only)

Must not be imported from browser bundles.

**Wallet (`wallet.ts`)**

- `getOrCreateWallet`, `getWalletBalance`, `mutateWallet` (idempotent credit/debit; negative amount = debit).
- `deductEntryFees` — both humans charged in one transaction before the match goes `ACTIVE`.
- `finalizeMatchPayout` — winner credited once; unique `payoutLedgerKey`.
- `refundAbortedMatch` — unique `abortRefundKey`.
- Errors: `WalletError` (`INSUFFICIENT_FUNDS`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`), `MatchSettlementError`.
- `PurchaseProvider` interface + `ManualPurchaseProvider` (pending → complete → `PURCHASE_CREDIT`).

**Auth (`auth.ts`, uncommitted)**

- `hashPassword` / `verifyPassword` — scrypt, 16-byte salt, 64-byte key, `saltHex:hashHex`, `timingSafeEqual`.
- Guest session TTL 7 days; registered session TTL 30 days.
- `displayNameFromEmail` for default names.

**Players (`players.ts`, uncommitted)**

- `provisionPlayer` — create user, wallet, starting-balance ledger, `USER_CREATED` audit.
- `issueSession` — 32-byte hex token, store SHA-256 hash, `SESSION_CREATED` audit.
- `claimGuestAccount` — attach email/password, set `isGuest=false`; conflicts: `EMAIL_TAKEN`, `ALREADY_REGISTERED`.
- `toAuthUser` — public `{ id, displayName, email, isGuest }`.

**Progression (`progression.ts`, uncommitted)**

- `recordMatchOutcome` — transactional, idempotent if all `MatchPlayer.result` already set. Updates results, XP/level, weekly + all-time leaderboard, `MATCH_FINALIZED` audit. Skips aborted matches and bot seats.
- `getPlayerStats` — totals + per-game rows.
- `getLeaderboards` — active games, ranked by win count.

Tests: `wallet.test.ts`, `auth.test.ts`, `progression.test.ts`.

### 7.4 `@kampi/game-sdk`

| Subpath | Runtime | Purpose |
|---------|---------|---------|
| `@kampi/game-sdk` | both | Backward-compatible embed re-exports |
| `/common` | both | Manifests, seats A/B, queue keys `game\|version\|mode\|stake\|region`, envelopes, clock/RNG, `SdkError` |
| `/client` | browser | `GameSessionClient` — queue, private invite, `joinById`, reconnect, `request_snapshot` |
| `/server` | node | `GameRegistry`, `SettlementCoordinator`, `CommandGuard`, `DeadlineScheduler`, `assertDistinctPlayers` |
| `/embed` | browser | `HostEmbedController` / game bridge, origin allowlists, Zod messages |
| `/testing` | tests | Fake clock, fake clients |

Security: browser code must not import `/server`, `@kampi/database`, or `@kampi/domain`. Tokens travel on the embed `session` message, **not** query strings. No wildcard `postMessage` origins.

### 7.5 Game rule packages (pure)

**`@kampi/game-rps-core`** — `rpsManifest`, `RpsGameConfigSchema` (bestOf, fees, timeouts), `SubmitChoiceCommandSchema`. Re-exports round resolution from contracts.

**`@kampi/game-penalty`** — `penaltyManifest`, directions `LEFT`/`RIGHT` (`CENTER` reserved), phases, turn resolution (same direction = SAVE, different = GOAL), timeout precedence (kicker miss beats GK no-dive), sudden-death pairing, bot pick helper. No Phaser, no Prisma.

---

## 8. HTTP API (`apps/api`, NestJS, port 4000)

**Bootstrap (`main.ts`)**

- Loads repo-root `.env`.
- CORS: web, admin, RPS origin, Penalty origin.
- Correlation-id middleware, global `ValidationPipe` (whitelist + forbid unknown), HTTP exception filter.
- Swagger at `/docs` when `NODE_ENV !== production`.
- Listens on `0.0.0.0` (Docker / Railway).
- Global `@nestjs/throttler` 120 req / 60s; auth routes tighter (guest 20/min, register/login/claim 10/min).

**Auth (`AuthGuard`)**

- Bearer token required.
- Special case: if `DEV_GUEST_AUTH_ENABLED` and token is `dev-guest-token-kampi-local-only`, maps to seeded `dev-player@kampi.local`.
- Otherwise looks up `Session.tokenHash` (SHA-256), `ACTIVE`, not expired, user `ACTIVE`.
- Attaches `{ id, displayName, email, isGuest }` (`email` / `isGuest` added in the uncommitted slice).

**Endpoints**

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health/live` | no | Liveness |
| GET | `/health/ready` | no | Readiness (Postgres) |
| POST | `/auth/guest` | no | Creates a **new** guest + wallet + session. Forbidden if guest auth disabled. |
| POST | `/auth/register` | no | Email/password account *(uncommitted)* |
| POST | `/auth/login` | no | Email/password *(uncommitted)* |
| POST | `/auth/claim` | yes | Convert current guest → registered *(uncommitted)* |
| POST | `/auth/logout` | yes | Revokes current session *(uncommitted)* |
| GET | `/auth/me` | yes | `{ user }` |
| GET | `/players/me` | yes | id, displayName, email, isGuest, balance string, **stats** |
| GET | `/wallet/balance` | yes | `{ balance }` string |
| GET | `/wallet/ledger?limit=` | yes | Recent ledger, amounts as strings |
| GET | `/games` | no | Active catalog + `clientUrl` from version config / env fallback |
| GET | `/games/:slug/config` | no | Fees, bestOf / kicks, timeouts, version JSON |
| GET | `/matches/history` | yes | Caller’s matches + result/score |
| GET | `/stats/me` | yes | XP/level/W-L-D + per-game *(uncommitted)* |
| GET | `/stats/leaderboard` | no | `?gameSlug&period=weekly\|all-time&limit=` *(uncommitted)* |

Request bodies for auth are parsed with Zod via `parseBody` (`apps/api/src/common/parse-body.ts`) so validation errors return field paths.

**Note:** the web lobby probes `GET /auth/config` for `{ guestAuthEnabled }`. That route is **not** implemented on the controller yet. Catalog load treats a failed probe as “guest play unavailable” and still allows login/register. Guest play continues to work via `POST /auth/guest` when the flag is on.

OpenAPI (dev): http://localhost:4000/docs

---

## 9. Realtime (`apps/realtime`, Colyseus 0.16, port 2567)

**Process**

- Express health: `/health/live`, `/health/ready` (DB + registered game ids).
- `WebSocketTransport` on `0.0.0.0`.
- `RedisPresence` for multi-instance presence and private invites.
- Rooms: `lobby`, `rps`, `penalty-duel`.
- SIGINT: graceful Colyseus shutdown + Prisma disconnect.

**Registry** (`apps/realtime/src/games/registry.ts`) registers RPS and Penalty manifests. Matchmaking keys: `gameId|gameVersion|mode|stakeKey|region`.

**Lobby**

- Authenticates join options with the same session tokens as the API.
- Public queue: pair two distinct humans immediately; otherwise start a bot timer from game config (`botFillAfterMs`).
- Never matches a player with themselves (`assertDistinctPlayers`).
- Creates a `Match` row via `match-factory` (fees, players, tickets) then `matchMaker.createRoom`.
- Private invites: 8-character codes (no ambiguous chars), Redis TTL 10 minutes, scoped to game/version/stake. Creator cannot occupy both seats. Bots off by default. Expired / full / wrong-game codes return typed errors.

**RPS room**

- Seats A/B (legacy PLAYER1/PLAYER2 still accepted).
- `SettlementCoordinator` wraps domain deduct / payout / refund.
- Concealed choices until both lock or round timeout.
- Best of 3; bot opponent after fill.
- Reconnect grace; forfeit or abort+refund depending on whether play started.
- After payout, `persistMatchOutcome` writes results, XP, leaderboards *(uncommitted hook)*.

**Penalty room**

- State machine: `WAITING_FOR_PLAYERS → STARTING → AWAITING_ACTIONS ⇄ REVEALING_RESULT → NEXT_TURN → FINISHED | ABORTED`.
- First kicker chosen with injectable RNG; roles alternate; 3 kicks each.
- First valid action per `turnId` locks; `commandId` is idempotent; stale/wrong-role rejected.
- Timeouts: kicker miss, GK no-dive = goal, both = miss (kicker precedence).
- Tie → paired sudden death until scores differ after a complete pair.
- Never replaces a human with a bot after H2H start.
- Same settlement + `persistMatchOutcome` path as RPS.

**Auth on sockets:** `apps/realtime/src/auth.ts` hashes the bearer token and loads the session/user (plus the local dev guest token).

---

## 10. Game clients

### Rock Paper Scissors (`apps/game-rps`)

- Vite + Phaser. Placeholder graphics.
- Uses `GameSessionClient` to queue / join / reconnect.
- **Find Match** waits for a human, then a bot after ~10s.
- Standalone or embedded from the web lobby.
- Docker: nginx static + `scripts/nginx-foreground.sh` so Railway/Heroku `PORT` is substituted into `listen`.
- Health: `GET /health/live` in nginx.

### Penalty Duel (`apps/game-penalty`)

- Vite + Phaser plus DOM overlays for a11y / Playwright selectors.
- Distinct guest via `POST /auth/guest` when no session token is stored (do not reuse the seeded dev token for two-player tests).
- Public queue and Create Private / Join Code.
- Presentation is placeholder primitives (goal box, keeper rect, ball). Asset swap guide: `docs/penalty-assets.md` — animations follow server `reveal` / `turnId`, never client prediction; respect `prefers-reduced-motion`.
- Docker image added in the uncommitted slice (same nginx PORT pattern).

Both clients bind Vite `--host` as needed; launch URLs live in `GameVersion.config.clientLaunchUrl` with env fallbacks.

---

## 11. Web platform shell (`apps/web`, Next.js, port 3000)

PWA metadata + `manifest.webmanifest` + apple-web-app flags. **No service worker** yet (avoids caching authenticated routes).

**Lobby (current working tree — large uncommitted rewrite of `page.tsx` + `globals.css`)**

- Bootstrap: load catalog, weekly leaderboard, restore `localStorage` / `sessionStorage` token (`kampi.authToken`), else auto-guest if guest auth is on.
- **Auth card:** login / register tabs; guests see **Save this account** (claim); logout; **New guest identity** / **Play as guest**.
- **Progression card:** level, XP, wins, losses (overall or per active game).
- **Games grid** from `GET /games` — Play opens an iframe (token sent via `HostEmbedController.sendSession`, not the URL).
- **In-play layout:** iframe + sidebar (balance, entry, payout, progression). Embed `balance_changed` / `match_completed` refresh player + leaderboard.
- **Weekly leaderboard** boards per game (win counts).
- API online/offline pill.

Dark mobile-first shell (`#0b1220`), 720px two-column grid, play layout with sidebar.

---

## 12. Admin shell (`apps/admin`, port 3001)

Placeholder operator UI. **Not production auth.** Nav: Players, Matches, Wallet Ledger, Games, System Health. Pages exist as stubs for local browsing.

---

## 13. Embedding

Protocol version `1.0.0`.

**Host → game:** `host_ready`, `session` (token + optional playerId), `locale`, `theme`, `request_close`.  
**Game → host:** `game_ready`, `balance_changed`, `match_started`, `match_completed`, `error`, `request_close`.

Origins allowlisted on both sides. Docs: `docs/embedding-sdk.md`. Capacitor / native WebView is designed for later; not installed.

---

## 14. Adding a third game (already documented)

`docs/adding-a-game.md` is the playbook: pure rules package → unit tests → Colyseus room on SDK server helpers → registry (avoid new `if (slug)` in generic matchmaking) → seed catalog → Vite client on `/client` + `/embed` → web catalog card → env/CSP → docs.

---

## 15. Local development

```bash
cp .env.example .env
docker compose up -d          # Postgres + Redis
pnpm install
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev                      # all apps in parallel
# or
pnpm dev:reset                # stop ports, clean caches, migrate, seed, start
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| Admin | http://localhost:3001 |
| API | http://localhost:4000 |
| Realtime | ws://localhost:2567 |
| RPS | http://localhost:5173 |
| Penalty | http://localhost:5174 |

`pnpm dev` starts **apps only**. `pnpm dev:all` also runs package watchers. Packages are built first by `dev:reset`.

**Two-player testing:** do not reuse `dev-guest-token-kampi-local-only`. Use **New guest identity**, `POST /auth/guest`, or register two accounts. Standalone Penalty auto-creates a guest when none is stored.

`scripts/restart-dev.sh` (via `pnpm dev:reset`): kills 3000 / 3001 / 4000 / 2567 / 5173 / 5174 and leftover turbo; cleans `.turbo` / `dist` / `.next` (Postgres volume stays); ensures `.env`; waits for Docker health; install → generate → build packages → migrate → seed → `pnpm dev`. Do not use `pnpm restart` (reserved lifecycle).

Postinstall `scripts/patch-colyseus-greeting.mjs` patches `@colyseus/greeting-banner` for Colyseus 0.16 on Node 20.

---

## 16. Docker and deployment

`docker-compose.yml` is **infrastructure only** (Postgres + Redis volumes + healthchecks). App images are per-service Dockerfiles.

**Uncommitted / updated images**

- **API:** Node 22 Alpine, `pnpm install --filter @kampi/api...`, Prisma generate, build, run `pnpm db:migrate && node apps/api/dist/main.js`.
- **Realtime:** same pattern, `node apps/realtime/dist/index.js` on 2567.
- **Web:** Next standalone output, `HOSTNAME=0.0.0.0`, `NEXT_PUBLIC_API_URL` build-arg.
- **RPS / Penalty:** Vite build → nginx 1.27; `LISTEN_PORT` templated; `scripts/nginx-foreground.sh` rewrites listen to `$PORT`.
- **`.dockerignore`:** node_modules, dist, `.next`, `.env`, markdown, progress reports.

Railway is **docs only** (`docs/railway-deployment.md`): recommended services, env vars, migrations as a one-off job, staging vs production, ownership transfer, post-deploy checklist. No Railway project has been created in this work.

Env that Docker/CI need beyond local: `GAME_PENALTY_PUBLIC_URL`, `VITE_REALTIME_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`. API/realtime now bind `0.0.0.0` so containers are reachable.

---

## 17. CI

`.github/workflows/ci.yml` on push/PR to `main`/`master`:

- Ubuntu, Node from `.nvmrc`, pnpm 9.15.4
- Service containers: Postgres 16 + Redis 7 (same credentials as Compose)
- `pnpm install --frozen-lockfile` → `db:generate` → `db:migrate` → `db:seed`
- `pnpm lint` → `typecheck` → `test` → `build`
- Guest auth on; penalty public URL set

CI does **not** boot the live stack. `KAMPI_LIVE_E2E=1` Vitest and Playwright are opt-in locally.

---

## 18. Tests

| File | What it covers |
|------|----------------|
| `packages/contracts/src/rps.test.ts` | Round resolution |
| `packages/contracts/src/auth.test.ts` | Auth Zod schemas |
| `packages/domain/src/wallet.test.ts` | Idempotent mutations, insufficient funds |
| `packages/domain/src/auth.test.ts` | scrypt verify, display-name from email |
| `packages/domain/src/progression.test.ts` | XP/level, idempotent outcome, leaderboards, bots skipped |
| `packages/game-sdk/src/index.test.ts` | Embed validation / origins |
| `packages/game-rps-core/src/index.test.ts` | Manifest / commands |
| `packages/game-penalty/src/index.test.ts` | Goals/saves/timeouts/sudden death |
| `apps/realtime/src/rooms/rps-room.test.ts` | Authoritative RPS |
| `apps/realtime/src/rooms/penalty-flow.test.ts` | Penalty flow |
| `apps/realtime/src/games/registry.test.ts` | Registry / protocol |
| `apps/realtime/src/sessions/private-invite.test.ts` | Invite TTL / codes |
| `apps/api/src/health/health.test.ts` | Health |
| `apps/web`, `admin`, `game-rps`, `game-penalty` `smoke.test.ts` | Boot/smoke |
| `apps/e2e/src/live-matchmaking.test.ts` | Opt-in Colyseus pair (no bot) |
| `apps/e2e/src/live-penalty-match.test.ts` | Opt-in full Penalty match |
| `apps/e2e/tests/penalty-two-player.spec.ts` | Playwright two isolated browser contexts |

Verified historically (Report #2): live matchmaking, regulation Penalty with identical scores, Playwright ~21s, lint/typecheck/test/build.

---

## 19. Documentation inventory

| Path | Contents |
|------|----------|
| `README.md` | Quick start, services, economy table |
| `AGENTS.md` | Layout, trust rules, commands, out of scope |
| `docs/architecture.md` | Diagrams, authority, packages |
| `docs/kickoff-scope.md` | In/out of scope, definition of done |
| `docs/local-development.md` | Setup, two guests, register curl, troubleshooting |
| `docs/railway-deployment.md` | Cloud checklist (not executed) |
| `docs/security-and-trust-boundaries.md` | Authority, ledger, auth hashing, embed, logging |
| `docs/embedding-sdk.md` | postMessage protocol |
| `docs/game-sdk.md` | Subpaths, matchmaking sequences, protocol versioning |
| `docs/adding-a-game.md` | Third-game playbook |
| `docs/penalty-duel.md` | Rules, state machine, local two-player |
| `docs/penalty-assets.md` | Art replacement without touching authority |
| `docs/client-decisions-required.md` | Open product questions |
| `docs/adr/001-*`, `002-*` | Realtime + BigInt wallet |
| `.kampi-progress-reports/REPORT-01-*`, `REPORT-02-*` | Dated slices |
| **This file** | Combined status including uncommitted work |

Security doc was updated to record: sessions hashed; email/password uses scrypt; guests only when `DEV_GUEST_AUTH_ENABLED` is on. Client-decisions item 4 now says email/password is implemented; OAuth / phone OTP / production guest policy remain open.

---

## 20. Security implemented in this phase

- Server-only resolution of moves, timers, finish, forfeit, abort.
- Hidden actions never broadcast until reveal.
- Protocol version checked by the registry.
- Session tokens: 256-bit random, SHA-256 at rest, never logged.
- Passwords: scrypt + unique salt + timing-safe compare.
- Guest minting disabled in production unless explicitly enabled.
- CORS allowlist (no `*`).
- Embed origin allowlist; no tokens in iframe query strings.
- Rate limiting foundation on API (global + tighter auth).
- Idempotent wallet + unique payout/refund keys.
- Correlation ids on HTTP; do not log full tokens / JWT secrets / extra PII.

Not implemented: production admin auth, WAF, geo blocking, collusion detection, multi-account abuse tooling.

---

## 21. Definition of done vs what actually works

Kickoff definition of done: *reproducible local vertical slice: queue → bot fill → best-of-three → single authoritative payout, with reconnect grace and passing CI.*

**That is done for RPS**, and **exceeded** by:

- Second game (Penalty Duel) with regulation + sudden death + forfeit/abort
- Human-vs-human public matchmaking (verified live, botFill false)
- Private invite codes
- Modular game SDK so a third game does not fork lobby code
- Playwright two-browser Penalty E2E
- Email/password + claim-guest (working tree)
- XP / level / weekly + all-time leaderboards wired from match finish (working tree)
- Lobby UI for auth, progression, catalog, iframe play, leaderboard (working tree)
- Container images that listen on `0.0.0.0` / `$PORT` (working tree)

---

## 22. Git: committed vs working tree

**On `origin/main` (4 commits)**

1. `a5409d1` Initial monorepo  
2. `4e94bac` restart all apis  
3. `0bf069f` Penalty 1v1 initial implementation  
4. `26a3ba6` Unclean-instance restart fixes  

**Modified (not committed) — highlights**

- API: auth register/login/claim/logout, guard user shape, players+stats, wallet/matches small wiring, `StatsModule`, `parse-body`, CORS for game origins, listen `0.0.0.0`
- Realtime: listen `0.0.0.0`, `persist-outcome.ts`, RPS + Penalty call it after settlement
- Domain: auth, players, progression + tests; tsconfig exports
- Contracts: auth + stats schemas; env `GAME_PENALTY_PUBLIC_URL` optional; PORT fallbacks
- Prisma: `passwordHash`, progression→game FK, migration `20260905183000_*`
- Web: full lobby/auth/progression/leaderboard UI + CSS
- Dockerfiles for api, web, realtime, game-rps; new Penalty Dockerfile + nginx; root `.dockerignore`; `nginx-foreground.sh`
- Docs: local-dev register/claim, security hashing, client-decisions auth item

**Untracked files of note**

`apps/api/src/common/parse-body.ts`, `apps/api/src/stats/*`, `apps/realtime/src/games/persist-outcome.ts`, `packages/contracts/src/auth.ts` + `stats.ts` + tests, `packages/domain/src/auth.ts` / `players.ts` / `progression.ts` + tests, `packages/database/prisma/migrations/20260905183000_auth_and_progression_fk/`, `apps/game-penalty/Dockerfile` + `nginx.conf`, `.dockerignore`, `scripts/nginx-foreground.sh`.

Nothing here has been pushed. There is no feature branch; all of this sits dirty on `main`.

---

## 23. Intentionally out of scope (this phase)

- Real-money gaming, KYC/AML, cash-out, geolocation, licensing, PCI
- Live Stripe / Apple / Google payments (schema + `PurchaseProvider` only)
- Production admin authentication
- Final art, audio, branding
- Capacitor / App Store / Play wrappers
- Analytics, moderation, chat
- Kubernetes, Kafka, service mesh
- OAuth / phone OTP
- CENTER kick/dive (schema reserved)
- CI job that boots the full stack for live E2E

---

## 24. Open product decisions

Still listed in `docs/client-decisions-required.md`:

1. Confirm RPS vs Penalty as the first production title  
2. Final fees, payouts, house edge, starting balance  
3. Branding, art, audio  
4. OAuth / phone OTP / production guest policy (email/password exists)  
5. Payment provider and regional pricing  
6. Launch regions  
7. Peak CCU / Colyseus+Redis sizing  
8. Analytics  
9. Moderation if social features appear  
10. Native store timeline  
11. Leaderboard periods / anti-cheat / resets (weekly + all-time exist as a first cut)  
12. Bot difficulty  
13. Anti-fraud / collusion  
14. Support tooling for virtual-chip disputes  

---

## 25. Known gaps and follow-ups

1. **Commit and push** the auth/progression/Docker working tree (owner-driven).  
2. **`GET /auth/config`** is called by the lobby but not implemented; add `{ guestAuthEnabled }` or stop probing it.  
3. **Railway** still documentation only.  
4. **CI live E2E** not wired (`KAMPI_LIVE_E2E=1` + Playwright need running API/realtime/5174).  
5. **Private-invite UI** is minimal; rate-limit hardening still light.  
6. **Placeholder art** for both games.  
7. **PWA service worker** not added by design.  
8. **Purchase completion** has no HTTP surface for operators beyond the domain class.  
9. **Admin** remains unauthenticated placeholders.  
10. **Nest ESM `@Inject`:** several controllers were fixed; any new injectable should follow that pattern.  
11. **Leaderboard rank** is computed at read time (order by score), not stored `rank` column.  
12. **Match outcome persistence** swallows errors to `console.error` so a stats failure cannot roll back an already-paid match — stats can lag; no retry worker yet.

---

## 26. Root commands (current)

```bash
pnpm dev            # all apps
pnpm dev:all        # apps + package watchers
pnpm dev:reset      # clean restart
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e       # stack must be up
pnpm format
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

---

## 27. How to exercise the current product

1. `pnpm dev:reset` (or Compose + migrate/seed + `pnpm dev`).  
2. Open http://localhost:3000.  
3. Register an account, or play as guest, or log in.  
4. Play RPS or Penalty from the catalog (iframe). Find Match for a bot after ~10s, or two browser profiles for H2H.  
5. After a finished match, lobby XP/wins and weekly leaderboard should update (requires the uncommitted persist-outcome path + migration applied).  
6. Optional: `curl -X POST http://localhost:4000/auth/register` as in `docs/local-development.md`.  
7. Optional: `pnpm test:e2e` with API + realtime + Penalty client running.

**Seeded single-player shortcut:** `Authorization: Bearer dev-guest-token-kampi-local-only` — 10,000 chips. Use only for one player.
