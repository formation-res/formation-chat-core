# Local Chat example

This example runs the React reference UI at `http://127.0.0.1:4173`. Its Node development server
proxies `/v1/*` to Chat Core, so browser requests stay on one origin and SSE responses remain
streamed. It also creates or updates one local tenant and site when it starts.

Use the mock connector first. Switch to Haystack after the browser, Chat Core, and PostgreSQL path
works.

## Prerequisites

- Node.js 24 and npm 11
- Docker with Compose
- Google Chrome if you also run the browser smoke tests
- A running Formation Haystack service for the Haystack path

Install and build once from the repository root:

```sh
npm ci
npm run build
```

## Run with the mock connector

Use three terminals from the repository root.

Terminal 1 starts PostgreSQL:

```sh
docker compose up -d postgres
```

Terminal 2 starts Chat Core. It runs pending migrations before listening:

```sh
DATABASE_URL=postgresql://chat_core:chat_core@127.0.0.1:5432/chat_core \
SESSION_TOKEN_SECRET=local-development-session-secret-1234567890 \
CONNECTOR_MODE=mock \
npm run start --workspace @formation-chat-core/server
```

Terminal 3 starts the UI and provisions the local site:

```sh
npm run dev --workspace @formation-chat-core/local-chat-example
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) and send a message. The mock connector returns a
deterministic response.

## Run with a Haystack agent

Start PostgreSQL as above and make sure Haystack is reachable from the host running Chat Core.
Then use this command in Terminal 2:

```sh
DATABASE_URL=postgresql://chat_core:chat_core@127.0.0.1:5432/chat_core \
SESSION_TOKEN_SECRET=local-development-session-secret-1234567890 \
CONNECTOR_MODE=haystack \
HAYSTACK_CONNECTORS='{"public-support":{"baseUrl":"http://127.0.0.1:8080","tenantKey":"formationxyz_com","agentSlug":"support","responseMode":"info_chat","timeoutMs":30000}}' \
npm run start --workspace @formation-chat-core/server
```

Change these values:

- `baseUrl`: Haystack's HTTP or HTTPS origin, without a path.
- `tenantKey`: the trusted Haystack tenant key.
- `agentSlug`: the Haystack agent slug.
- `responseMode`: the response mode accepted by that agent.

Keep the map key `public-support` aligned with `LOCAL_CHAT_AGENT_REF`. Then start the UI with the
same Terminal 3 command.

The compatibility connector calls `POST /api/agents/knowledge/chat`. That endpoint is synchronous,
so a Haystack answer appears after the complete response has been validated.

## Configuration

The defaults work with the repository's Compose PostgreSQL service.

| Variable                    | Default                 | Purpose                                        |
| --------------------------- | ----------------------- | ---------------------------------------------- |
| `DATABASE_URL`              | local Compose database  | Database used to provision the tenant and site |
| `LOCAL_CHAT_CORE_URL`       | `http://127.0.0.1:3000` | Chat Core origin proxied by the UI server      |
| `LOCAL_CHAT_PORT`           | `4173`                  | Local UI port                                  |
| `LOCAL_CHAT_TENANT_ID`      | `local-tenant`          | Provisioned tenant ID                          |
| `LOCAL_CHAT_SITE_ID`        | `local-site`            | Provisioned site ID                            |
| `LOCAL_CHAT_SITE_KEY`       | `local-chat`            | Public site key passed by the browser client   |
| `LOCAL_CHAT_AGENT_REF`      | `public-support`        | Trusted connector-map lookup key               |
| `LOCAL_CHAT_SKIP_PROVISION` | unset                   | Set to `true` when the site already exists     |

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
