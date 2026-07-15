# ADR-005: Use the Node.js TypeScript reference toolchain

## Status

Accepted

## Date

2026-07-15

## Context

The reference service and SDKs need one reproducible TypeScript toolchain. The public contract must
remain usable from Python and other languages, and PostgreSQL behavior must not be hidden behind a
vendor-specific application framework.

## Decision

- Use Node.js 24 LTS and npm 11 workspaces. Pin the repository's Node line and package-manager major.
- Use TypeScript 6 in strict ESM mode. TypeScript 7 is deferred because the selected lint parser
  does not yet declare support for it.
- Use Fastify 5 for the HTTP server and SSE response handling.
- Define JSON Schema with TypeBox and validate external data with Ajv. Commit generated standalone
  JSON Schema and OpenAPI 3.1 artifacts; derive TypeScript types from the same schema definitions.
- Use Kysely with `pg` for typed PostgreSQL access and Kysely's migration primitives for ordered,
  explicit SQL migrations.
- Use Vitest for unit and integration tests, ESLint with `typescript-eslint` for static analysis,
  and Prettier for deterministic formatting.
- Pin direct dependency versions in the lockfile and use automated review for upgrades.

## Alternatives considered

### Express

Express has a larger ecosystem, but Fastify has first-class TypeScript support, JSON Schema route
validation, structured logging, and lower-level streaming access without assembling the same base
from unrelated middleware.

### NestJS

NestJS provides a comprehensive application framework. Its decorators, dependency-injection
container, and framework conventions would become an unnecessary public-service implementation
constraint for this small headless core.

### Prisma or Drizzle

Both provide productive schema tooling. Kysely keeps SQL and transaction boundaries explicit,
supports PostgreSQL-specific concurrency patterns needed for ordering and idempotency, and does not
introduce a second schema language. Migrations remain reviewable SQL-oriented code.

### Zod as the contract source

Zod is ergonomic for TypeScript-first applications, but JSON Schema and OpenAPI are authoritative
here. TypeBox models JSON Schema directly, which reduces conversion ambiguity for Python and other
consumers.

### Node's built-in test runner

It would reduce dependencies. Vitest was selected for workspace-aware configuration, fixtures,
coverage, and a mature TypeScript developer experience across future browser packages.

### TypeScript 7 immediately

TypeScript 7 is available, but `typescript-eslint` 8.64 declares support only below TypeScript 6.1.
Forcing the peer dependency would make lint results unsupported. Upgrade after the lint toolchain
adds declared compatibility.

## Consequences

- Contributors need Node.js 24 LTS and npm 11.
- Runtime packages stay framework-neutral even though the reference HTTP adapter uses Fastify.
- Protocol artifacts need a drift check so generated schemas cannot silently diverge.
- Database logic remains visible and testable against real PostgreSQL.
- Major tool upgrades, especially TypeScript 7, require compatibility verification before adoption.
