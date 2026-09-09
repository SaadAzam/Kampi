# Penalty demo readiness — 9 September 2026

## Live demo

- Lobby: https://web-production-fc16.up.railway.app
- API readiness: https://api-production-635f.up.railway.app/health/ready
- Realtime readiness: https://realtime-production-d79b.up.railway.app/health/ready
- Penalty client: https://game-penalty-production.up.railway.app
- Railway project: https://railway.com/project/74c72010-d4cf-412f-a1df-07a2dc05ec4d

The frontend, API, realtime service, both game clients, PostgreSQL and Redis are deployed in the existing Railway production project. Matches, wallet ledger, results, XP and rankings persist in PostgreSQL. No database reset or production reseeding was performed.

## Improvements

- Reconnect requests are coalesced, retry within the 30-second recovery window, and request an authoritative snapshot. Cancelled/destroyed clients cannot reopen a late-arriving room.
- Penalty sessions can resume after a full page refresh. The lobby restores the active game; the game keeps a per-account, per-tab reconnection reservation in session storage. A failed/expired resume unlocks a clear route to another match and history.
- Lost matchmaking connections show an error instead of leaving a permanent spinner. Actions are disabled while reconnecting; snapshots reconcile submissions whose acknowledgements were lost.
- The connection SDK loads with the game, avoiding failures caused by requesting an obsolete lazy-loaded SDK chunk after a deployment.
- A reconnect audit-write failure cannot forfeit a successfully restored player. A cancellation during entry deduction cannot restart the cancelled match.
- Completed penalty results wait for stats to save, with retries that do not repeat payouts. A background job repairs missing stats for finished penalty matches from durable server result events, including after process restarts. Weekly credit uses the match's completion date.
- Planned realtime shutdown cancels and refunds unfinished penalty matches instead of awarding a random forfeit.
- History shows opponent, score, result, date and game, and refreshes after matches, when returning to the tab, and periodically. Player stats and rankings refresh with it.
- Updated vulnerable Multer and Vitest dependencies. Test discovery explicitly includes source tests and avoids running compiled duplicates.

## Verification completed

- Workspace typecheck, lint, tests and production build passed.
- Dependency audit: zero known vulnerabilities across all severity levels.
- Four PostgreSQL wallet integration tests passed, covering concurrent debits, idempotency, transaction rollback and payout/refund races.
- Seven integration scenarios passed against the public Railway backend: human matchmaking, regulation match, sudden death, private invite, three successive reconnects using fresh clients, one player exhausting reconnect grace, and both players exhausting reconnect grace.
- Completed-match scenarios verified identical server scores, expected balances, history records and XP. One-player disconnect produced a single forfeit payout; both-player disconnect restored both balances to 10,000 chips.
- Browser verification on the public deployment: guest login, bot matchmaking, active-match full-page refresh into the same match ID, final result, updated 15 XP/one loss, and the same 0–3 match in History.
- Responsive browser checks: 320×568, 390×844 and 844×390. No horizontal overflow at narrow portrait or landscape sizes; action buttons measured 58px high and matchmaking buttons 48px high at 320px.
- Regression tests cover connection cancellation races, overlapping reconnect attempts, stats retries, reconnect audit failure, planned shutdown and cancellation during startup.

An initial concurrent matchmaking run encountered a local DNS lookup failure. The completed rerun passed all five original live scenarios; both additional disconnect-expiry scenarios passed separately. An open pre-deployment browser also had stale client assets; the final client now loads its SDK eagerly, and browser gameplay succeeded after reload.

## Demo sequence

1. Open the lobby URL and keep the same browser/account so history stays associated with the player. Use Account → Save this account if a persistent registered identity is desired.
2. Open Penalty Duel. Choose Find match for public matchmaking; a bot fills after roughly 10 seconds without a human opponent.
3. For two-person play, use Challenge a friend and enter the invite code in a second device or independent browser profile. The same account cannot play against itself.
4. Pick left/right before each server deadline. Each player gets three regulation kicks; ties proceed to paired sudden death.
5. Refresh during an active match to demonstrate resume within the recovery window. Return to the lobby after completion and open History, Account and Rankings.

## Operational boundaries

The 30-second reconnect grace restores the same live room. Server decision timers continue during a network interruption; missing a deadline still counts as a timeout. A disconnected opponent is never replaced with a bot mid-match.

Planned restarts refund unfinished matches. Seamless continuation of an in-progress match after a hard realtime process crash is not implemented; completed-match stats can be repaired, but active game state is held in memory. Keep one realtime replica for this demo and avoid deployments during the presentation. Multi-replica routing, sustained load and physical iOS/Android network switching have not been certified by these checks. Browser storage restrictions may prevent full-page resume, while in-memory reconnect remains available.

Graphics remain placeholders for the assets you plan to supply. These checks support demo readiness, not a promise of zero defects under every device or failure condition.

Code changes were deployed from the local working tree. They have not been committed or pushed; commit them before a later GitHub deployment to preserve this tested version.

## Final deployment record

All application deployments reported SUCCESS after verification:

- web: `e559a9c9-7b2d-4d91-a770-ae8384d3a6c9`
- api: `ee0aa0f3-89e7-4507-afd7-4df943a40764`
- realtime: `714bf337-44e4-4a24-a96a-8d0747fb302c`
- game-penalty: `098fe541-93c6-431d-98f8-0d8be04ade47`
- game-rps: `60c0b918-823a-49e8-b065-dbddefaf56f7`

Dependency advisory references: [Multer](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) and [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). Final package audit confirmed zero known advisories.
