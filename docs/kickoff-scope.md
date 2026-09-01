# Kickoff scope

## In scope (this foundation)

- TypeScript monorepo (pnpm + Turborepo)
- PostgreSQL + Prisma schema for users, wallets, matches, progression
- NestJS API with health, guest auth, wallet, games config
- Colyseus realtime server with authoritative RPS room
- Real-player-first matchmaking with bot fallback
- Vite + Phaser RPS client (placeholder graphics)
- Next.js web shell with PWA manifest
- Minimal admin shell
- Embedding SDK (iframe/postMessage)
- Docker Compose for Postgres/Redis
- CI pipeline and Railway deployment docs

## Out of scope

- Real-money gaming, KYC/AML, geolocation, licensing
- Payment provider integration (interface + pending purchase model only)
- Production admin authentication
- Final branding/assets
- Capacitor / native store releases
- Analytics, moderation tooling
- Kubernetes / Kafka / service mesh

## Assumptions

- First game: Rock Paper Scissors, best of 3
- Virtual chips only — purchasable later, never withdrawable
- Development guest auth enabled locally; disabled in production by default

## Definition of done for this phase

Reproducible local vertical slice: queue → bot fill → best-of-three → single authoritative payout, with reconnect grace and passing CI.
