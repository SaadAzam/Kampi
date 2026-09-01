# Security and trust boundaries

## Server-authoritative gaming

The realtime server is the sole authority for:

- Move validity and timing
- Round and match outcomes
- Match timers and expiration
- Match finalization and abort/refund decisions

Game clients render state received from the server only.

## Wallet integrity

- Chips stored as PostgreSQL `BigInt`
- Ledger entries are append-only/immutable
- Every debit/credit uses a unique idempotency key
- Match entry, payout, and refund run in database transactions
- A match pays out at most once (`payoutLedgerKey` unique constraint)

## Authentication

- Sessions stored as SHA-256 hashes — raw tokens are never logged
- Development guest auth (`DEV_GUEST_AUTH_ENABLED`) disabled in production by default
- API rate limiting foundation via `@nestjs/throttler`

## Embedding

- postMessage origins validated on both sides
- No secrets in game client bundles
- Iframe hosts must use HTTPS in production

## Logging

Do not log:

- Complete auth tokens
- JWT secrets
- Unnecessary PII

## Real-money boundary

This prototype implements **virtual chips only**. Real-money gaming would require a separate security programme: PCI DSS, KYC/AML, licensing, fraud detection, geolocation enforcement, enhanced audit trails, and independent review.

## Redis / Postgres

- Use private network in production
- Rotate credentials on environment promotion
- Separate staging and production databases
