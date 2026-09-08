# Railway deployment

Kampi is a **multi-service** Railway project: API, realtime, web, two game clients, PostgreSQL, and Redis.

## What Railway needs

- Each app binds `0.0.0.0` and Railway's `PORT` (falls back to `API_PORT` / `REALTIME_PORT` locally).
- Docker builds use the **repo root** as context and `apps/<service>/Dockerfile`.
- API runs `pnpm db:migrate` on boot.
- Staging can set `DEV_GUEST_AUTH_ENABLED=true` so you can play without registering.

## Auto-deploy from GitHub

Pushes to `main` deploy through [`.github/workflows/deploy-railway.yml`](../.github/workflows/deploy-railway.yml). That workflow uploads the commit to Railway for api, realtime, web, game-rps, and game-penalty.

GitHub CI (lint / typecheck / test / build) is separate and already runs from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### One-time secret

Railway is signed in with email, not GitHub, so Railway cannot install its own GitHub webhook. The Action uses a **project token** instead:

1. Create a production project token (Railway dashboard → Project → Settings → Tokens, or the CLI below).
2. Add it as the GitHub Actions repository secret `RAILWAY_TOKEN` at https://github.com/SaadAzam/Kampi/settings/secrets/actions

```bash
railway api --compact --variables "$(cat <<'JSON'
{
  "input": {
    "name": "github-actions",
    "projectId": "74c72010-d4cf-412f-a1df-07a2dc05ec4d",
    "environmentId": "836d08e4-332b-47f5-9d0f-8f4b647e758a"
  }
}
JSON
)" 'mutation($input: ProjectTokenCreateInput!) { projectTokenCreate(input: $input) }'
```

Dashboard: https://railway.com/project/74c72010-d4cf-412f-a1df-07a2dc05ec4d

### Optional native Railway GitHub deploys

If you later connect GitHub on https://railway.com/account and install the [Railway GitHub App](https://github.com/apps/railway) on `SaadAzam/Kampi`, you can switch services to repo auto-deploy and disable the GitHub Action so each push is not built twice.

Dockerfiles must `COPY patches` because `package.json` lists a pnpm patched dependency. A GitHub/Dockerfile build that omits `patches/` fails at `pnpm install`.

## One-time project setup

```bash
# once
npm i -g @railway/cli
railway login

railway init --name kampi
railway add --database postgres
railway add --database redis
railway add --service api
railway add --service realtime
railway add --service web
railway add --service game-rps
railway add --service game-penalty
```

Generate a public domain for each public service (`railway domain --service api`, etc.), then set variables using those hostnames. Shared backend variables:

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<32+ chars>
WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
API_PUBLIC_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
REALTIME_PUBLIC_URL=wss://${{realtime.RAILWAY_PUBLIC_DOMAIN}}
GAME_RPS_PUBLIC_URL=https://${{game-rps.RAILWAY_PUBLIC_DOMAIN}}
GAME_PENALTY_PUBLIC_URL=https://${{game-penalty.RAILWAY_PUBLIC_DOMAIN}}
DEV_GUEST_AUTH_ENABLED=true
STARTING_CHIPS=10000
RPS_ENTRY_FEE=500
RPS_WINNER_PAYOUT=950
BOT_FILL_AFTER_MS=10000
RECONNECT_GRACE_MS=30000
```

Web build arg / variable:

```text
NEXT_PUBLIC_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
```

Game client build args:

```text
VITE_REALTIME_PUBLIC_URL=wss://${{realtime.RAILWAY_PUBLIC_DOMAIN}}
VITE_WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
```

In each service's settings, set **Dockerfile path** to:

| Service | Dockerfile |
|---------|------------|
| api | `apps/api/Dockerfile` |
| realtime | `apps/realtime/Dockerfile` |
| web | `apps/web/Dockerfile` |
| game-rps | `apps/game-rps/Dockerfile` |
| game-penalty | `apps/game-penalty/Dockerfile` |

Then upload the current working tree for a one-off (does not require a git push):

```bash
railway up --service api --detach --yes
railway up --service realtime --detach --yes
railway up --service web --detach --yes
railway up --service game-rps --detach --yes
railway up --service game-penalty --detach --yes
```

Seed after the first API deploy:

```bash
railway run --service api pnpm db:seed
```

## Health

| Service | Path |
|---------|------|
| API | `GET /health/ready` |
| Realtime | `GET /health/ready` |
| Web | `GET /` |
| Game clients | `GET /health/live` |

## Staging vs production

- Distinct `JWT_SECRET`, databases, and public URLs per environment
- Use Railway private networking between API, realtime, Postgres, and Redis when available
- Keep `DEV_GUEST_AUTH_ENABLED=false` on a real production project
