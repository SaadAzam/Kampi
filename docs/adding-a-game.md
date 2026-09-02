# Adding a third game

1. **Rules package** — Create `packages/game-<slug>` with Zod config/commands, pure resolvers, bot policy, and a `GameManifest`. No Phaser, no Prisma.
2. **Unit tests** — Cover resolution, timeouts, phase rejection, and deterministic RNG.
3. **Realtime room** — Implement an authoritative Colyseus room using `@kampi/game-sdk/server` (`SettlementCoordinator`, `CommandGuard`, `DeadlineScheduler`). Register via `apps/realtime/src/games/registry.ts` and `defineRoom`.
4. **Lobby** — Prefer registry + config parsers; avoid new `if (slug === …)` branches in generic matchmaking where a table/strategy can work.
5. **Seed/catalog** — Upsert `Game` + `GameVersion` with `clientLaunchUrl`, stake, and rule config. API lists games from DB.
6. **Client app** — Vite + Phaser (or other) under `apps/game-<slug>`, using only `@kampi/game-sdk/client` + `/embed` + your rules package.
7. **Web launch** — Catalog card comes from `/games`; no hardcoded URLs beyond env fallbacks.
8. **Scripts** — Ensure root `pnpm dev` / lint / typecheck / test / build include the workspace. Update `.env.example` and CSP/connect origins narrowly.
9. **Docs + report** — Document rules/state machine and local two-player testing.
