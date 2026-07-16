# Formation Chat Core

Formation Chat Core is a self-hosted, open-source service for durable AI chat. It will
provide identity, sessions, conversations, message storage, streaming, synchronization, and a
stable connector protocol without tying applications to one agent runtime or UI framework.

The first production connector will target Formation's Haystack agents. The protocol is intended
to support other agent systems and message sources without changing the chat model.

## Project status

Tasks 1 through 16 are complete. The repository now has the TypeScript toolchain, language-neutral
contracts, PostgreSQL-backed sessions and conversations, idempotent user messages, ordered event
storage, reconnectable SSE delivery, durable connector jobs, and a deterministic mock agent. Task
11 adds the React reference UI, Task 12 adds the Cloudflare gateway example, Tasks 13 and 14 add
Haystack connector paths, Task 15 completes email handoff, and Task 16 adds separately authenticated
read-only admin APIs. Haystack integration remains an adapter outside the core.

## Start here

1. Read [the project brief](docs/PROJECT_BRIEF.md).
2. Read [the implementation plan](docs/IMPLEMENTATION_PLAN.md).
3. Review [the architecture decisions](docs/decisions/).
4. Follow [AGENTS.md](AGENTS.md) when using a coding agent in this repository.

The implemented API behavior is documented under [docs/api](docs/api/). The deployable static-site
gateway is documented in [examples/cloudflare-worker](examples/cloudflare-worker/README.md).
The temporary Haystack integration is documented in
[docs/connectors/haystack-compatibility.md](docs/connectors/haystack-compatibility.md).

## Intended repository layout

```text
apps/
  server/                 HTTP API, event streaming, and job execution
  dashboard/              Separate operations UI
packages/
  protocol/               JSON Schema, OpenAPI, and generated TypeScript types
  server-sdk/             Connector and extension interfaces
  browser-client/         Framework-neutral browser client
  ui-react/               Optional React UI
  ui-web-component/       Optional portable custom element
connectors/
  mock/                   Deterministic development connector
  haystack/               Reference Haystack connector
examples/
  static-website/
  authenticated-app/
  cloudflare-worker/
docs/
```

Directories should be added as their first working vertical slice is implemented. Empty
architecture scaffolding tends to become misleading.

## Planned runtime

- TypeScript and Node.js
- PostgreSQL as the production source of truth
- HTTP for commands and queries
- Server-Sent Events for live events and reconnects
- OpenAPI 3.1 and JSON Schema as language-neutral contracts
- Optional browser, React, Web Component, and Cloudflare packages

ADR-005 selects Fastify, TypeBox/Ajv, Kysely with `pg`, Vitest, ESLint, and Prettier for the
reference implementation.

## License

See [LICENSE](LICENSE).
