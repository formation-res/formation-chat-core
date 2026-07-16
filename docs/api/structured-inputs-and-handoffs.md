# Structured inputs and handoffs

Chat Core stores the public handoff lifecycle and purpose-bound contact decision. Haystack owns
the external email side effect. Contact values remain private: they are not message parts, public
events, browser state, or API response fields.

## Lifecycle

1. A connector emits `handoff.requested`, then `contact.requested` with `inputKind: email`,
   `purpose: handoff_email_delivery`, and a stable request ID.
2. Chat Core records both resources and moves the run to `waiting_for_input`.
3. The browser posts either `{ "value": "visitor@example.com", "consent": true }` or
   `{ "declined": true }` to
   `POST /v1/conversations/{conversationId}/inputs/{requestId}`.
4. Chat Core validates the typed value, records the consent decision, and requeues the same run.
5. The resumed connector request contains the private decision in `resolvedInputs`. Submitted
   email values cross only the authenticated server-to-server connector boundary.
6. Generic `handoff.completed`, `run.completed`, or stable `run.failed` events expose the outcome.

The input write requires the session's `inputs:write` scope and an `Idempotency-Key`. Tenant, site,
principal, conversation, request, and run scope are checked together. Reusing a key with changed
input returns `IDEMPOTENCY_CONFLICT`. Successful responses return only the structured-input
resource status and metadata, never its value.

Connector retries receive the original trigger message, the current canonical history, and the
recorded resolution. A resumed run may therefore contain assistant messages after the original
`currentMessage`.
