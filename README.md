# Formation Chat Core

Formation Chat Core is a planned self-hosted, open-source service for durable AI chat. It will
provide identity, sessions, conversations, message storage, streaming, synchronization, and a
stable connector protocol without tying applications to one agent runtime or UI framework.

The first production connector will target Formation's Haystack agents. The protocol is intended
to support other agent systems and message sources without changing the chat model.

## Project status

The repository currently contains the confirmed project brief, architecture decisions, and the
implementation plan. Runtime code has not started. Begin with Phase 1 of the plan instead of
adding a UI or Haystack-specific behavior directly to the core.

## Start here

1. Read [the project brief](docs/PROJECT_BRIEF.md).
2. Read [the implementation plan](docs/IMPLEMENTATION_PLAN.md).
3. Review [the architecture decisions](docs/decisions/).
4. Follow [AGENTS.md](AGENTS.md) when using a coding agent in this repository.

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

The specific server framework, database library, and test runner are intentionally left for the
first implementation task. Record those choices in an ADR before adopting them.

## License

See [LICENSE](LICENSE).
