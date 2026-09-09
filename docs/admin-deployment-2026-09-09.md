# Kampi admin — deployed 9 September 2026

Admin URL: https://admin-production-5af0.up.railway.app

## Access

A dedicated `Kampi Administrator` account has been created. The login identifier is `admin@kampi.local`; no email inbox is required. Its generated 40-character password is supplied separately in a local owner-readable access file, not in this repository or in Railway build variables.

The API grants administrator privileges only to exact registered account IDs listed in its `ADMIN_USER_IDS` variable. There is no default admin account, email-based privilege matching, guest access, or public admin data endpoint. Keep this dedicated account for administration rather than sharing it with demo players.

The admin frontend authenticates via its own server, verifies API admin authorization, and stores the session in an eight-hour Secure, HTTP-only, SameSite=Strict cookie. It never exposes bearer tokens to client JavaScript. Mutations require the configured admin origin. Logout revokes the backend session. Existing API login rate limits apply.

## Available capabilities

- Overview: player/guest/suspended counts, match totals and statuses, per-game counts, seven-day activity, daily UTC match totals, XP/win totals, circulating virtual chips, and ledger totals by type.
- Players: paginated search by display name, email or user ID; balance and per-game XP, level, wins and losses; suspend/reactivate; reasoned positive or negative chip adjustments.
- Matches: paginated search by game, player name or match ID; participants, scores, outcomes, bot status and economy; event timeline and settlement ledger.
- Wallet: immutable ledger with amounts and resulting balances, searchable by player, user ID, match ID or idempotency key.
- Games: active versions and existing configuration; pause/enable new matches. Match creation rechecks game availability and player eligibility, including already-connected clients. Existing matches are allowed to finish.
- Health: live API/PostgreSQL and realtime readiness probes.
- Audit: paginated records of administrator identity, affected entity, reason and change.

Sensitive mutations are transactional. Chip changes use the existing wallet lock, balance invariant and idempotency checks; retries do not double-credit. Audit records commit with the change. Admin accounts cannot be suspended through this interface. Suspension revokes API sessions and prevents new joins/matches; a match already in progress may finish.

## Verification

- Workspace lint, typecheck, tests and production build passed.
- Three realtime regression tests verify paused games and suspended players cannot bypass controls through an existing lobby or bot match.
- Four authorization tests cover fail-closed behavior, guest rejection, exact-ID matching and unauthenticated denial.
- Three local PostgreSQL integration tests cover idempotent adjustments, conflicting/excessive debits, session revocation, reactivation, protected admin accounts, game availability and audit records. Fixtures were isolated and removed afterwards.
- Live Railway checks verified every admin data endpoint, secure cookie flags, missing/guest authorization denial, cross-origin mutation denial, match timeline, duplicate adjustment prevention, suspension/reactivation, audit records and logout revocation.
- Live mutation checks used a fresh test player. Its +100-chip adjustment was retried without a second credit, then reversed to restore its starting balance. Its suspension was reversed; the old session remained revoked as expected. Existing player balances and game availability were not changed by these tests.
- Browser verification covered real sign-in, overview totals, player search, match results, event timelines and health. A mobile navigation overflow found in testing was corrected; the deployed player table and pages were verified at 320px and 390px with no page overflow.
- A complete two-human penalty match passed against Railway after the first admin rollout, including score, payout, history and XP verification.
- Dependency audit reported zero known vulnerabilities.

## Deployment configuration

Railway service `admin` builds from repository root using `apps/admin/Dockerfile` and runs its Next.js standalone server on port 8080. Runtime variables: `API_PUBLIC_URL`, `ADMIN_PUBLIC_URL`, `NODE_ENV`, `PORT`; build selection: `RAILWAY_DOCKERFILE_PATH`. API configuration includes `ADMIN_USER_IDS`. No database migration was required.

The GitHub Railway deployment workflow now includes the admin service. Changes were deployed from the local working tree and have not been committed or pushed in this task.

Administrative capabilities described above are functional. Payment providers, cash-out, forced live-match outcome changes and general-purpose game configuration editing are not exposed as working admin controls.

## Verified deployments

- Admin: `f96bc1f2-6be5-4fa1-9df6-f8ddde580220` — SUCCESS
- API: `f1a2b004-1e19-49c0-bdde-4c58500c6817` — SUCCESS
- Realtime: `f31671c5-a7a4-4813-88df-5fad161f1aee` — SUCCESS
