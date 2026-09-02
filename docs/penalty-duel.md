# Penalty Duel (Goal Kicks)

Authoritative 1v1 shootout. Rules package: `@kampi/game-penalty`. Client: `apps/game-penalty` (`@kampi/game-penalty-app`, port 5174).

## Config (validated)

| Key | Default |
|-----|---------|
| `regulationKicksPerPlayer` | 3 |
| `decisionTimeMs` | 10_000 |
| `revealDurationMs` | 2_000 |
| `botFillAfterMs` | ~10_000 |
| `directions` | `LEFT`, `RIGHT` (`CENTER` reserved for a future version) |

## State machine

```text
WAITING_FOR_PLAYERS → STARTING → AWAITING_ACTIONS ⇄ REVEALING_RESULT → NEXT_TURN
                                         ↓
                                      FINISHED | ABORTED
```

Timers are cleared on every transition and room disposal. Late callbacks must not resolve a newer turn.

## Turn rules

- Seats A/B; first kicker chosen server-side with injectable RNG.
- Roles alternate each turn; six regulation kicks total (three each).
- Kicker: `SHOOT_LEFT|RIGHT`. Goalkeeper: `DIVE_LEFT|RIGHT`.
- First valid action for `turnId` locks; stale/late/wrong-role/unauthorized rejected. Same `commandId` is idempotent.
- Same direction → `SAVE`; different → `GOAL`.
- Kicker timeout → `MISS`. GK timeout alone → `GOAL` (`NO_DIVE`). Both → `MISS` (kicker precedence).
- Tie after regulation → paired sudden death; finish only when scores differ after a complete pair.

## Disconnect / forfeit

- Reconnect grace preserves seat and sends a full snapshot.
- Deadlines continue while disconnected.
- Never replace a human with a bot after H2H start.
- Grace expiry → forfeit for the connected opponent (settle once).
- Both gone before meaningful play → abort/refund once.

## Local two-player test

1. `pnpm db:seed` then `pnpm dev` (or `pnpm dev:reset`).
2. Open two browser profiles/contexts at `http://localhost:5174`.
3. Each context auto-creates a distinct guest via `POST /auth/guest` (or use web “New guest identity” then launch from lobby).
4. Both click **Find Match** quickly (before bot fill), or Create Private / Join Code.
5. Confirm matching `match-id`, opposite seats, role swaps, identical scores, single winner.
6. Optional: `pnpm test:e2e` with API + realtime + penalty client running.
