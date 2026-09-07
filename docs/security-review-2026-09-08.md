# Kampi security and mobile gameplay review — 8 September 2026

## Delivered

Reviewed the existing working tree and `docs/work-completed.md`, preserving the owner's uncommitted work. Changes are local; nothing was committed, pushed, or deployed.

The lobby follows the supplied reference's dark blue visual style, compact two-column game catalog, balance header, and bottom navigation. It uses the two real games and working account/ranking data, with replaceable placeholder graphics. The reference's additional games, cash/reward features, chat, and tournaments were not represented as working features.

Penalty Duel now has accessible HTML controls around its Phaser pitch, inline friend invitations, cancel search, replay, explicit role/lock states, kick history, reduced-motion support, responsive resizing, and a countdown synchronized to server time. Frame sessions are delivered on load/readiness instead of after a fixed delay. Guest-account saving now calls the correct claim endpoint.

## Security findings fixed

| Finding                                                                                 | Fix                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match rooms accepted client-supplied creation options, including identities and economy | Server lobby signs room options; both game rooms reject unsigned or altered creation requests.                                                                                         |
| RPS seat joining did not authenticate the bearer token                                  | Authenticate every join; require the reserved human identity; reject duplicate occupation and bot-seat access.                                                                         |
| Realtime accepted a fixed development token regardless of environment                   | Disable the fixed token in production and whenever development guest auth is disabled; check user status and token size. API rejects the disabled fixed token before session fallback. |
| RPS hidden choices were decorated as public Colyseus schema fields                      | Remove pending choices from schema serialization; regression test encodes and decodes actual state to verify no leak.                                                                  |
| Concurrent wallet operations could use the same stale balance                           | Lock the wallet row and update ledger and balance in one transaction.                                                                                                                  |
| Entry fees were charged through separate transactions                                   | Lock the match and debit both human players atomically, using stable wallet lock order.                                                                                                |
| Aborts could refund an entry that was never charged                                     | Refund only a matching, owned, negative entry ledger record, for its actual amount.                                                                                                    |
| Payout and refund could race or partially persist                                       | Lock the match and execute each settlement atomically; validate stored payout, winner membership, and terminal state.                                                                  |
| Idempotency keys did not verify mutation identity                                       | Reject reuse with a different owner, amount, type, match, or purchase.                                                                                                                 |
| Guest claims could overwrite each other                                                 | Conditional update requires an active, still-guest account.                                                                                                                            |
| Concurrent outcome processing could duplicate or lose progression                       | Serialize outcome processing on match and player rows.                                                                                                                                 |
| Private invite requests were unbounded and could race                                   | Bound and validate requests, rate limit each socket, and reserve both sockets before asynchronous invite consumption.                                                                  |
| Queue key components and websocket payloads were unbounded                              | Validate bounded queue components and cap websocket messages at 16 KiB.                                                                                                                |
| Invalid history/ledger limits reached Prisma                                            | Validate integer limits in the API.                                                                                                                                                    |
| Dependency advisories                                                                   | Updated vulnerable PostCSS, Nano ID, and DeepmergeTS resolutions; final npm audit has zero reported advisories.                                                                        |

## Penalty lifecycle fixes

- Wait for both humans to connect before charging or starting a turn; expire abandoned waiting rooms.
- Authenticate reserved seats and reject duplicate joins.
- Reject wrong-match/protocol commands and moves received at or after the authoritative deadline.
- Keep directions private until reveal; prevent changing an already locked action.
- Preserve reconnection behavior and request fresh state after reconnect. Client retries handle a server that has not yet detected a closed socket.
- Prevent concurrent terminal events from settling twice. Retry temporary payout/refund failures without publishing an unpaid final result.
- Do not reconnect when the server intentionally closes a completed match.
- Clear turn/room timers on disposal and handle asynchronous audit-write failures.

## Validation

| Check                                | Result                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Workspace TypeScript checks          | Passed                                                                                                         |
| Workspace ESLint checks              | Passed                                                                                                         |
| Workspace unit/test tasks            | Passed                                                                                                         |
| Production builds                    | Passed                                                                                                         |
| Live public matchmaking              | Passed                                                                                                         |
| Live two-human regulation shootout   | Passed; matching scores and winner, correct balances                                                           |
| Live sudden death                    | Passed; paired extra kicks and correct balances                                                                |
| Live private invitation shootout     | Passed                                                                                                         |
| Live disconnect/reconnect shootout   | Passed                                                                                                         |
| Actual room security/lifecycle tests | Passed, including forfeit races and failed-settlement retry                                                    |
| PostgreSQL concurrency regressions   | 4 passed: concurrent debits, duplicate retries, entry rollback, competing payout/refund                        |
| Dependency audit                     | 0 advisories after patching; 9 before                                                                          |
| Browser verification                 | Lobby, embedded session, private-invite creation/cancellation, bot fill, timeout results, balance/XP refresh   |
| Responsive inspection                | 320×568, 360×800, 390×844, 768×1024, 1024×768, 1440×900, 844×390; corrected 320px pitch overflow and rechecked |

Controls measured at 48–58px high. Browser viewport checks are not a substitute for testing physical iOS/Android devices. The existing Playwright test was updated, but browser checks in this session used the connected browser rather than claiming a new Playwright runner result.

## Reproduce

Use Node 22 and pnpm 9.15.4. Install with the checked-in lockfile, generate Prisma, then run:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm audit
KAMPI_LIVE_E2E=1 pnpm --filter @kampi/e2e test
KAMPI_DB_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run packages/domain/src/wallet.integration.test.ts
```

The integration suites require the local Postgres/Redis and API/realtime stack. The database regression suite refuses non-local database hosts and cleans up its own fixtures. Live matchmaking creates test guest/match records.

Dependency changes include a checked-in Colyseus patch for Nano ID's named export and an explicit greeting-banner resolution. The existing banner compatibility script now scans finite known package locations, supporting hoisted and isolated installs without traversing dependency cycles.

## Preview and remaining deployment work

Preview: `http://localhost:3100` (API 4100, realtime 2667, Penalty 5274, RPS 5273). This uses an isolated Next production build. The previously running frontend processes on the default ports could not be terminated by this session; restart the owner's normal development stack to discard stale dependency references. The normal source configuration retains its usual ports.

This review does not certify production security. Final graphics/audio, physical-device testing, load/multi-instance testing, deployment credentials and headers, operational monitoring, and recovery of matches after a process/host crash still need deployment-specific work. Match statistics retain the existing best-effort persistence path; a durable retry worker is not implemented. Admin remains the pre-existing placeholder shell. There are no real-money payments or cash-out changes.
