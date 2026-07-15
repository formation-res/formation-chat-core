# ADR-002: Make the chat core the canonical web-chat store

## Status

Accepted

## Date

2026-07-15

## Context

Formation's current Haystack service stores conversation history keyed by tenant, agent, user, and
thread. The new service also needs durable conversations for synchronization, dashboards, and
connectors that are unrelated to Haystack. Two authoritative transcripts would create conflicts in
ordering, retention, deletion, and recovery.

## Decision

The chat core is the canonical source for web-chat principals, conversations, messages, public
events, and handoff state. Agent runtimes own execution traces, tool details, retrieval records,
and provider-specific continuation identifiers.

The first Haystack compatibility connector may map core IDs to the existing history fields. This
duplication is temporary. A native Haystack connector endpoint will accept normalized history from
the core and stop treating its web history as authoritative.

## Alternatives considered

### Let each agent runtime own conversations

This keeps agents self-contained but forces the chat client and dashboard to understand every
runtime's storage and session model.

### Store complete transcripts in both systems indefinitely

This simplifies early integration but leaves no reliable answer when records differ. Deletes and
retention rules also become difficult to enforce.

## Consequences

- Connector run requests include the normalized public history needed by the agent.
- The admin dashboard reads chat data only through the chat-core admin API.
- Haystack requires a migration from its existing synchronous history-owning web endpoint.
- Email and Zulip may keep channel-specific delivery records without becoming web-chat authorities.
