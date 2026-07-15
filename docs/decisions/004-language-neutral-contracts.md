# ADR-004: Publish language-neutral contracts

## Status

Accepted

## Date

2026-07-15

## Context

The reference implementation and browser packages use TypeScript, while the first agent runtime is
Python. Future connectors and clients may use other languages. TypeScript-only types would make the
protocol harder to implement correctly elsewhere.

## Decision

Publish OpenAPI 3.1 and JSON Schema as the public contract. Generate or validate TypeScript types
from those schemas. Apply the same schemas to connector network events.

Use additive evolution where possible. Removing a field, changing its meaning, or changing event
ordering requires an explicit compatibility plan.

## Alternatives considered

### TypeScript types as the only contract

This is convenient for the reference implementation but gives Python and other runtimes no stable,
machine-readable source.

### Framework-specific RPC

RPC can improve TypeScript developer experience but couples public consumers to one server and
client toolchain.

## Consequences

- Schema artifacts and examples must ship with implementation changes.
- Contract fixtures can test connectors in different languages.
- The project must decide how schemas and generated types stay synchronized.
- Public errors, pagination, IDs, timestamps, and event envelopes need consistent schemas.
