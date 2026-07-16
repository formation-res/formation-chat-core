# Local Chat example

This example runs the visitor chat, operations dashboard, Chat Core, and PostgreSQL as one local
stack. Both browser UIs use loopback-only same-origin proxies. The visitor proxy streams the public
API; the dashboard proxy exposes only `/v1/admin/*`.

## Prerequisites

- Node.js 24 and npm 11
- Docker with Compose
- Google Chrome if you also run the browser smoke tests
- A running Formation Haystack service for the Haystack path

Install once from the repository root:

```sh
npm ci
```

## Start everything

From the repository root, run:

```sh
npm run dev:local
```

The command builds the workspaces, starts PostgreSQL if needed, runs database migrations, starts
Chat Core with the deterministic mock agent, provisions the local site, and serves:

- visitor chat: [http://127.0.0.1:4173](http://127.0.0.1:4173)
- operations dashboard: [http://127.0.0.1:4174](http://127.0.0.1:4174)
- Chat Core health/API origin: [http://127.0.0.1:3000](http://127.0.0.1:3000)

Send a visitor message first. Then open the dashboard and paste the scoped admin token printed by
`dev:local`. The conversation and its run/events will appear there. A bare `GET /` on port 3000 is
not a UI route; use ports 4173 and 4174 for the browser interfaces.

Stop everything owned by the command with Ctrl+C, or from another terminal:

```sh
npm run dev:local:stop
```

If PostgreSQL was already running before `dev:local`, the stop command leaves it running. Local
database data is retained between runs.

## Use a Haystack agent

Make sure Haystack is reachable, then start the same stack with a connector map:

```sh
LOCAL_CHAT_CONNECTOR_MODE=haystack \
HAYSTACK_CONNECTORS='{"public-support":{"baseUrl":"http://127.0.0.1:8080","tenantKey":"formationxyz_com","agentSlug":"support","responseMode":"info_chat","timeoutMs":30000}}' \
npm run dev:local
```

Change these values:

- `baseUrl`: Haystack's HTTP or HTTPS origin, without a path.
- `tenantKey`: the trusted Haystack tenant key.
- `agentSlug`: the Haystack agent slug.
- `responseMode`: the response mode accepted by that agent.

Keep the map key `public-support` aligned with `LOCAL_CHAT_AGENT_REF`.

The compatibility connector calls `POST /api/agents/knowledge/chat`. That endpoint is synchronous,
so a Haystack answer appears after the complete response has been validated.

## Configuration

The defaults work with the repository's Compose PostgreSQL service.

| Variable                    | Default                 | Purpose                                        |
| --------------------------- | ----------------------- | ---------------------------------------------- |
| `DATABASE_URL`              | local Compose database  | Database used to provision the tenant and site |
| `LOCAL_CHAT_CORE_URL`       | `http://127.0.0.1:3000` | Chat Core origin proxied by the UI server      |
| `LOCAL_CHAT_PORT`           | `4173`                  | Visitor UI port                                |
| `LOCAL_CHAT_DASHBOARD_PORT` | `4174`                  | Operations dashboard port                      |
| `LOCAL_CHAT_CONNECTOR_MODE` | `mock`                  | `mock` or `haystack`                           |
| `LOCAL_CHAT_TENANT_ID`      | `local-tenant`          | Provisioned tenant ID                          |
| `LOCAL_CHAT_SITE_ID`        | `local-site`            | Provisioned site ID                            |
| `LOCAL_CHAT_SITE_KEY`       | `local-chat`            | Public site key passed by the browser client   |
| `LOCAL_CHAT_AGENT_REF`      | `public-support`        | Trusted connector-map lookup key               |
| `LOCAL_CHAT_SKIP_PROVISION` | unset                   | Set to `true` when the site already exists     |
| `LOCAL_CHAT_SKIP_BUILD`     | unset                   | Set to `true` to reuse existing build output   |

The UI binds only to `127.0.0.1`. The generated browser configuration contains the public site key
only. Database credentials and Haystack configuration stay in local Node or Chat Core processes.

To provision without starting the UI:

```sh
npm run provision --workspace @formation-chat-core/local-chat-example
```

## Verify the example

```sh
npm test --workspace @formation-chat-core/local-chat-example
npm run test:browser --workspace @formation-chat-core/local-chat-example
npm run typecheck --workspace @formation-chat-core/local-chat-example
npm run lint --workspace @formation-chat-core/local-chat-example
npm run build --workspace @formation-chat-core/local-chat-example
```

The tests cover configuration validation, parameterized provisioning, static UI delivery, origin
forwarding, and unbuffered SSE proxying. `test:browser` expects the mock core and local UI to be
running. It sends a real message in Chrome, checks API responses and axe results, and saves wide and
narrow screenshots in the system temporary directory.
