# ADR 001: Server-authoritative realtime

## Status

Accepted

## Context

1v1 games must not trust clients for outcomes or payouts.

## Decision

Use Colyseus for authoritative match rooms. Clients send intentions; server resolves rounds, timers, and settlement via `@kampi/domain`.

## Consequences

- Requires always-on realtime service
- Reconnection handled via Colyseus `allowReconnection(client, seconds)` and `client.reconnect(reconnectionToken)`
