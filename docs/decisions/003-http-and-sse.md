# ADR-003: Use HTTP commands and SSE events in v1

## Status

Accepted

## Date

2026-07-15

## Context

Public chat needs streamed responses, reliable reconnects, ordinary request authentication, and
support through static-site gateways such as Cloudflare Workers. V1 does not need bidirectional
socket messages because user commands can use HTTP requests.

## Decision

Use normal HTTP endpoints for commands and queries. Use Server-Sent Events for live conversation
events. Give each conversation event a monotonically increasing sequence and stable event ID.

Clients reconnect with the last event ID. The service replays retained events or emits
`sync.required`, after which the client fetches the canonical snapshot.

## Alternatives considered

### WebSockets only

WebSockets support bidirectional communication but add connection state and proxy complexity. They
do not remove the need for durable snapshots, replay rules, or idempotent commands.

### Polling only

Polling is simple but adds response latency and unnecessary requests during streamed agent output.

## Consequences

- The protocol needs explicit replay retention and snapshot fallback rules.
- Cloudflare and other gateways must pass response streams without buffering.
- Client writes remain retryable and observable as normal HTTP requests.
- WebSockets can be added later as another transport for the same event envelope.
