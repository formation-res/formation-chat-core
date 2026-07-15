# ADR-001: Run the core as a standalone service

## Status

Accepted

## Date

2026-07-15

## Context

The chat system must integrate with public websites, authenticated applications, Haystack, and
future agent runtimes built with different languages. It needs one implementation of sessions,
persistence, streaming, retries, and administration.

## Decision

Run the authoritative chat runtime as a standalone network service. Publish thin client and
connector libraries that make it easy to embed, while keeping state and execution semantics in the
service.

The initial deployment is self-hosted. It may run on the same machine and private container network
as Haystack.

## Alternatives considered

### Embed the runtime in each host application

This reduces the number of deployed services and removes a network hop. It also ties support to
specific languages and frameworks, spreads database migrations across host applications, and
makes streaming and retry behavior inconsistent.

### Maintain both standalone and embedded stateful runtimes

This offers deployment choice but creates two implementations of conversation ordering,
persistence, and connector behavior. The implementations are likely to diverge.

## Consequences

- Integrations need network access to the chat service.
- Operators must deploy, monitor, migrate, and back up one additional stateful service.
- All languages can integrate through the same public protocol.
- The browser SDK, UI modules, Cloudflare gateway, and connector SDKs can remain small.
- A hosted service may be added later without changing the core integration model.
