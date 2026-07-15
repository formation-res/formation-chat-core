# Conversations and messages

Conversation and message endpoints require the bearer token returned by session bootstrap. The
server derives tenant, site, principal, and agent identity from that token and trusted site
configuration. A request cannot select or override those values.

## Conversations

`POST /v1/conversations` accepts an empty JSON object and requires `Idempotency-Key`. It creates one
active conversation with one user participant and the site's configured agent participant. A retry
with the same key returns the original conversation.

`GET /v1/conversations/{conversationId}` returns a conversation only when the token matches its
tenant, site, and principal. `GET /v1/conversations` returns the same scoped records in descending
creation order. Use `limit` from 1 to 100 and pass `pagination.nextCursor` to fetch the next page.

## User messages

`POST /v1/conversations/{conversationId}/messages` accepts one or more text parts and requires
`Idempotency-Key`. The core stores the user message as completed and returns `202`. A retry with the
same key and body returns the original message. Reusing the key with a different body returns `409`
with code `IDEMPOTENCY_CONFLICT`.

PostgreSQL assigns each accepted message the next sequence while holding the conversation row lock.
Concurrent requests therefore produce one contiguous order without duplicate sequence numbers.

`GET /v1/conversations/{conversationId}/messages` returns messages in ascending sequence order.
Use the returned cursor for the next page. Invalid cursors return `400 INVALID_CURSOR`.

The server returns `401` for a missing or invalid bearer token. It returns `403` when the token
lacks the required scope. Resources outside the token's tenant, site, or principal scope return
`404` so the response does not reveal whether another scope owns the identifier.

## Run cancellation

`POST /v1/conversations/{conversationId}/cancel` requires `Idempotency-Key`. The response reports
whether a queued run was cancelled, active work received a best-effort cancellation request, or the
latest run had already finished. Retrying the same key returns the original outcome.
