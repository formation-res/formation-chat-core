# Connector SDK and mock connector

`@formation-chat-core/server-sdk` defines the in-process connector boundary. A connector receives a
normalized run request, a reserved assistant message ID, and an `AbortSignal`. It returns an async
stream of protocol `ConnectorEvent` values. The SDK has no Haystack, model-vendor, database, or UI
dependency.

The server treats connector output as untrusted. It checks the JSON shape, conversation ID, run ID,
and assistant message ID before storing an event. Public events reach SSE subscribers. Operator and
internal events stay in the event store and never enter the public stream.

## Durable execution

The message transaction creates one queued agent run with stable run and assistant message IDs.
Workers claim jobs with PostgreSQL row locks and a lease. A process can reclaim an expired lease
after restart. Active workers renew their lease during long connector calls. The stable assistant
message ID prevents connector retries from creating a second transcript message.

Completed assistant content is written to the canonical message table before the completion event
is published. Clients can recover the transcript through message queries if transient events are
no longer retained.

## Deterministic mock

`@formation-chat-core/mock-connector` emits a fixed sequence containing run state, tool status, a
citation, text deltas, and final message content. Its failure scenario emits `run.failed` with a
configured error code.

The server keeps connector execution disabled by default. Set `CONNECTOR_MODE=mock` to run the
background mock worker. Local Compose enables this mode.

Worker settings:

- `RUN_WORKER_POLL_INTERVAL_MS`: idle polling interval, default `250`
- `RUN_LEASE_MS`: claim lease, default `30000`
- `RUN_MAX_ATTEMPTS`: maximum claims before manual intervention, default `3`

## Cancellation

`POST /v1/conversations/{conversationId}/cancel` requires the session bearer token and an
`Idempotency-Key`. It returns `cancelled` for a queued run, `cancel_requested` for active work, or
`already_finished` for a terminal run.

Active connectors in the same process receive an aborted signal and a `cancel()` call. The durable
status also lets another worker observe the request. Cancellation is best effort because an
external runtime may finish before it handles the signal.

The synchronous Formation Haystack adapter and its temporary duplicate-history behavior are
documented in [Haystack compatibility integration](haystack-compatibility.md).
