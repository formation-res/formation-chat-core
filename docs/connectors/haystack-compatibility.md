# Haystack compatibility integration

The first Haystack integration uses the existing synchronous knowledge-chat endpoint. This gives
the core an end-to-end agent path without making Haystack types part of the generic protocol.

## Boundary

The server resolves a connector only from the configured core `agentRef`. Each binding fixes the
Haystack base URL, tenant key, agent slug, optional response mode, and timeout. Browser-controlled
tenant, site, connector, and agent headers never participate in this mapping.

The connector sends only the current user message because the compatibility endpoint loads its own
thread history. Correlation metadata includes both core message IDs and the run ID. It also includes
`compatibility_mode: duplicate_history`, making this temporary behavior visible in Haystack's
stored request metadata.

## Temporary duplicate history

For web chat during this phase:

- chat core is authoritative for visitor sessions, transcripts, ordering, replay, deletion, and
  the admin API;
- Haystack keeps its existing thread history only to execute the compatibility request; and
- operators must diagnose or reconcile transcript differences against chat core, never copy
  Haystack history back into the public transcript.

Task 14 replaces this endpoint with a stateless streaming connector endpoint that consumes the
core's normalized history. Email and Zulip storage remain outside this web-chat migration.

## Failure and visibility behavior

The connector emits `run.started` before the request but delays `message.started` until the complete
response passes size, JSON, schema, tenant, agent, channel, and thread checks. Failures are reduced
to stable public codes such as `HAYSTACK_TIMEOUT`, `HAYSTACK_UNAVAILABLE`,
`HAYSTACK_INVALID_RESPONSE`, and `HAYSTACK_REJECTED`; provider response bodies and exceptions are
not exposed.

Only response text, normalized tool labels, safe citations, and the handoff-request flag become
public events. Raw metadata remains on the Haystack side. Handoff delivery and structured contact
collection are implemented separately in Task 15.
