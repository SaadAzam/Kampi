# ADR 002: BigInt chips with immutable ledger

## Status

Accepted

## Context

Floating-point currency causes rounding bugs; financial events must be auditable.

## Decision

Store chips as PostgreSQL `BigInt`. Expose as strings in JSON. All mutations append `WalletLedgerEntry` rows with idempotency keys.

## Consequences

- API serializers must stringify BigInt
- Refunds/payouts safe to retry
