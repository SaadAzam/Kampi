# Game SDK architecture

`@kampi/game-sdk` is the shared contract between platform clients, game clients, and the Colyseus realtime server. Game-specific rules live in separate packages (`@kampi/game-rps-core`, `@kampi/game-penalty`). Phaser presentation stays in game apps.

## Public entry points

| Subpath | Runtime | Purpose |
|---------|---------|---------|
| `@kampi/game-sdk` | browser / node | Backward-compatible re-exports (embed helpers) |
| `@kampi/game-sdk/common` | browser / node | Manifests, seats, queue keys, envelopes, clock/RNG, `SdkError` |
| `@kampi/game-sdk/client` | browser | `GameSessionClient` — lobby queue, private invite, match join, reconnect |
| `@kampi/game-sdk/server` | node | `GameRegistry`, `SettlementCoordinator`, `CommandGuard`, `DeadlineScheduler` |
| `@kampi/game-sdk/embed` | browser | Host/game iframe `postMessage` bridge with origin allowlists |
| `@kampi/game-sdk/testing` | tests | Fake clock, fake clients, harness helpers |

## Security boundary

- Browser bundles must not import `@kampi/game-sdk/server`, `@kampi/database`, or `@kampi/domain`.
- Identity and seat come from authenticated connections, never from client-supplied `playerId`.
- Bearer tokens travel over the embed `session` message or standalone auth bootstrap — **not** query strings.
- No wildcard `postMessage` origins.
- Pending hidden actions stay in server-private memory; public snapshots expose lock flags only.

## Registry model

Realtime registers each game module once:

```ts
registry.register(rpsManifest);
registry.register(penaltyManifest);
```

Matchmaking keys are `gameId|gameVersion|mode|stakeKey|region`. Adding a third game means: new rules package + room + client app + seed/catalog registration — not edits inside generic SDK matchmaking.

## Matchmaking sequences

### Public

1. Distinct authenticated clients call `GameSessionClient.joinQueue()` for the same game/version/stake.
2. Lobby pairs two humans immediately when both wait in the same queue key.
3. After `botFillAfterMs`, a lone public waiter may be paired with a bot.
4. Clients receive `match_found` with seat reservation, then `joinById` with auth token + seat.

### Private

1. Creator calls `createPrivateSession()`; lobby stores invite in Redis/Presence with TTL.
2. Joiner calls `joinPrivateSession(code)`.
3. Codes are scoped to game/version/stake; bots are off by default.
4. Creator cannot occupy both seats; expired/full/wrong-game codes return typed errors.

## Protocol version policy

- Manifests carry `protocolVersion` and `configSchemaVersion`.
- Breaking message or rule changes require a new game version in the catalog and a new client build.
- Clients must send `protocolVersion` on actions; servers reject mismatches via the registry.
