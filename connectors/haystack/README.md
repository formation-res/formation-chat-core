# Haystack compatibility connector

`@formation-chat-core/haystack-connector` adapts a core run to Formation Haystack's synchronous
`POST /api/agents/knowledge/chat` endpoint. It is intentionally temporary: chat core remains the
canonical web transcript while this endpoint also writes Haystack history.

## Trusted mapping

The connector instance owns `tenantKey` and `agentSlug`; it never derives them from browser input.
It maps `principalId` to `user_id`, `conversationId` to `thread_id`, and the current completed user
text to `text`. The request metadata records the core run, user message, reserved assistant message,
conversation, agent binding, and optional trusted origin.

Responses are limited to 1 MiB and validated before `message.started` is emitted. A timeout,
transport error, non-success response, mismatched correlation field, or invalid body therefore
fails the run without creating a partial assistant transcript. Raw tool arguments, tool results,
handoff reasons, and arbitrary Haystack metadata are not made public.

Validated response text becomes message events. `used_tools` becomes public tool status,
`rag_sources` becomes safe citation events and final citation parts, and
`metadata.handoff.requested` becomes a generic handoff request. Citation URLs are retained only for
HTTPS sources.

## Reference server configuration

Set `CONNECTOR_MODE=haystack` and provide a JSON map keyed by the core's trusted agent reference:

```sh
HAYSTACK_CONNECTORS='{"public-support":{"baseUrl":"http://haystack:8080","tenantKey":"formationxyz_com","agentSlug":"support","responseMode":"info_chat","timeoutMs":30000}}'
```

Unknown agent references are not routed to a default Haystack agent. `baseUrl` must be an HTTP or
HTTPS origin without credentials, path, query, or fragment. Plain HTTP is allowed for the intended
private Docker network; use HTTPS across untrusted networks.

## Verify the live compatibility contract

With `haystack-mailagent` checked out beside this repository:

```sh
npm run test:contract --workspace @formation-chat-core/haystack-connector
```

Set `HAYSTACK_MAILAGENT_DIR` when the checkout is elsewhere. The check loads Haystack's current
FastAPI OpenAPI document and verifies the endpoint, request fields, response fields, and statuses
used by this adapter.
