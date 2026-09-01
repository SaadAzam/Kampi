# Railway deployment

Documentation only — do not run these commands until Railway projects are created.

## Recommended services

| Railway service | Root directory | Build | Start | Health |
|-----------------|----------------|-------|-------|--------|
| Web | `/` | `pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @kampi/web build` | `node apps/web/server.js` (standalone) | `GET /` |
| API | `/` | `pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @kampi/api build` | `node apps/api/dist/main.js` | `GET /health/ready` |
| Realtime | `/` | `pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @kampi/realtime build` | `node apps/realtime/dist/index.js` | `GET /health/ready` |
| RPS client | `/` | `pnpm install --frozen-lockfile && pnpm --filter @kampi/game-rps build` | nginx static (`apps/game-rps/Dockerfile`) | `GET /health/live` |
| PostgreSQL | Railway plugin | — | — | — |
| Redis | Railway plugin | — | — | — |

Use each app's `Dockerfile` for container builds if preferred.

## Environment variables (all backend services)

```text
DATABASE_URL          # from Railway PostgreSQL
REDIS_URL             # from Railway Redis
JWT_SECRET            # ≥32 chars, unique per environment
WEB_ORIGIN            # https://your-web.up.railway.app
ADMIN_ORIGIN          # optional
API_PUBLIC_URL        # https://your-api.up.railway.app
REALTIME_PUBLIC_URL   # wss://your-realtime.up.railway.app
GAME_RPS_PUBLIC_URL   # https://your-rps.up.railway.app
DEV_GUEST_AUTH_ENABLED=false
STARTING_CHIPS=10000
RPS_ENTRY_FEE=500
RPS_WINNER_PAYOUT=950
BOT_FILL_AFTER_MS=10000
RECONNECT_GRACE_MS=30000
```

Web additionally needs:

```text
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_GAME_RPS_URL
```

Game RPS build:

```text
VITE_REALTIME_PUBLIC_URL=wss://...
```

## Database migrations

Run before or during API/realtime deploy:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed   # staging only, or custom seed
```

Recommended: one-off Railway deploy job or CI step that runs migrations against `DATABASE_URL`.

## Staging vs production

- Separate Railway projects or environments per stage
- Distinct `DATABASE_URL`, `JWT_SECRET`, and public URLs
- Never enable `DEV_GUEST_AUTH_ENABLED` in production unless explicitly intended
- Use Railway private networking between API, realtime, Postgres, and Redis when available

## Ownership transfer

1. Add the client's Railway team as project members with Admin role.
2. Transfer project ownership from Settings → Transfer Project.
3. Rotate all secrets (`JWT_SECRET`, database credentials) at cutover.
4. Update DNS/custom domains in the client's Cloudflare or registrar.

## Post-deploy checklist

- [ ] Health endpoints return 200
- [ ] Migrations applied
- [ ] CORS origins match deployed URLs
- [ ] WebSocket endpoint uses `wss://`
- [ ] PWA manifest icons accessible
- [ ] Guest auth disabled in production
