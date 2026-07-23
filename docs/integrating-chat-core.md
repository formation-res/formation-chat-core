# Integrate Chat Core into an app or website

This guide covers two ways to add Chat Core to an existing product:

- **Manual:** your team makes each backend, database, and frontend change directly.
- **Agentic:** Codex or Claude inspects both repositories, implements the same steps, and reports the
  verification evidence.

Both ways produce the same runtime shape:

```text
website widget or app
  -> shared gateway or host backend
  -> Formation Chat Core
  -> configured connector
  -> Haystack or another agent runtime
```

The gateway is required for a public website. One shared gateway can serve many websites and
widgets. It fixes the trusted site and widget, keeps service credentials out of browser code,
filters routes and headers, and passes SSE bodies through without buffering.

## What you need

Before starting, collect:

1. The website's exact production origin, such as `https://www.example.com`.
2. A stable Chat Core tenant ID, site ID, public site key, and public widget key.
3. The trusted `agentRef` for this widget, plus any public agent alias the website is allowed to
   pass.
4. The connector settings. For Haystack these are its base URL, tenant key, agent slug, response
   mode, and timeout.
5. PostgreSQL and an HTTPS deployment for Chat Core.
6. A shared backend route or edge gateway for the widget script, widget configuration, `/v1/*`, and
   protected dashboard assets.
7. A package delivery plan for the browser client, optional React UI, and embeddable widget bundle.

The packages are private workspaces in this repository today. A separate application must consume
them from a shared monorepo, approved internal registry, or reviewed package artifacts. Do not copy
compiled files into a website without a versioning and update plan.

## Manual integration

### 1. Deploy Chat Core and PostgreSQL

Run Chat Core as a stateful service with PostgreSQL. Configure unique secrets, HTTPS ingress,
backups, retention, logs, and metrics using the operations guides under `docs/operations`.

The server runs pending migrations at startup. Test migrations against a disposable database before
deploying a release.

### 2. Configure the connector

For one Haystack agent:

```sh
CONNECTOR_MODE=haystack
HAYSTACK_CONNECTORS='{"support":{"baseUrl":"http://haystack:8080","tenantKey":"example_com","agentSlug":"support","responseMode":"info_chat","timeoutMs":30000}}'
```

The map key `support` is the trusted `agentRef`. Browser input must never choose `baseUrl`,
`tenantKey`, or `agentSlug`.

Keep Haystack on a private network when possible. Use HTTPS when traffic crosses an untrusted
network.

### 3. Create the tenant, site, and widget binding

Provision through an operator-controlled migration, script, or admin process. The current schema
stores the site and its default trusted agent binding:

```sql
insert into tenants (tenant_id, display_name)
values ('example', 'Example');

insert into sites (
  site_id,
  tenant_id,
  site_key,
  display_name,
  allowed_origins,
  agent_ref
)
values (
  'example-website',
  'example',
  'example-public-chat',
  'Example website',
  '["https://www.example.com"]'::jsonb,
  'support'
);
```

Use parameterized SQL in a real provisioning script. Treat tenant and site changes as operator
actions. Do not expose them as public browser endpoints.

For the shared-widget architecture, model the embeddable widget as an operator-controlled binding
on top of the site. Until a dedicated widget table exists, the site's `siteKey`, `allowedOrigins`,
and `agentRef` are the trusted binding. A public embed may include style, widget-version, and
placement values. If it includes an `agent` value, that value is only a public alias that must be
allowed for the widget's hostname and resolved server side to the trusted `agentRef`.

### 4. Add the shared gateway

Expose only these public routes:

```text
POST /v1/sessions
GET, POST /v1/conversations
GET /v1/conversations/{conversationId}
GET, POST /v1/conversations/{conversationId}/messages
GET /v1/conversations/{conversationId}/events
POST /v1/conversations/{conversationId}/inputs/{requestId}
POST /v1/conversations/{conversationId}/cancel
POST /v1/conversations/{conversationId}/retry
```

The gateway must:

- serve the widget script and public widget configuration for known hostnames and widget keys;
- inject the trusted site key during session bootstrap;
- resolve any public agent alias to a trusted `agentRef` before core traffic is accepted;
- preserve the browser's exact allowed origin;
- forward `Authorization`, `Idempotency-Key`, `Last-Event-ID`, `Accept`, and `Content-Type` where
  required;
- remove browser-supplied tenant, site, agent, connector, forwarding, and service-token headers;
- reject admin and identity-exchange routes;
- stream SSE responses instead of reading them into memory;
- enforce request-size, origin, method, and rate limits;
- authenticate to Chat Core's private ingress without exposing that credential to the browser.

The Cloudflare implementation in `examples/cloudflare-worker` is the current gateway reference. The
target production shape is a shared deployment whose registry maps many hostnames and widgets to
trusted site keys, allowed origins, widget style/version defaults, and agent bindings. A host
backend can apply the same rules with its own framework.

### 5. Embed the widget or add the browser client

For a plain website, use a small script tag plus public configuration:

```html
<script
  src="https://chat.example.com/widget.js"
  data-widget-key="example-public-chat"
  data-theme="light"
  data-launcher="agent"
  data-agent="support"
  async
></script>
```

The public `data-agent` value is an alias, not a raw connector setting. The shared gateway or core
must reject aliases that are not configured for that hostname and widget.

Use the website's own origin as the transport URL:

```ts
import { createChatClient, createHttpChatTransport } from '@formation-chat-core/browser-client';

export const chatClient = createChatClient({
  siteKey: 'example-public-chat',
  transport: createHttpChatTransport({ baseUrl: window.location.origin }),
});
```

The client owns session bootstrap, local anonymous identity, conversation state, retries, SSE
reconnects, event cursors, deduplication, and snapshot recovery. Do not persist its bearer token in
application state or browser storage.

### 6. Render the React reference UI

```tsx
import { ChatPanel } from '@formation-chat-core/ui-react';
import '@formation-chat-core/ui-react/styles.css';

import { chatClient } from './chat-client';

export function SupportChat() {
  return <ChatPanel client={chatClient} title="Ask support" />;
}
```

Use `renderMessage`, `renderPart`, `labels`, CSS custom properties, and normal CSS to fit the host
design. Keep protocol state in the browser client instead of duplicating it in the component tree.

For a non-React website, subscribe to `chatClient` and render `state.messages`, `state.liveMessages`,
connection status, and structured input requests with the site's own view layer.

### 7. Verify the integration

Test at least these cases:

- first anonymous session and first conversation;
- page refresh and same-browser resume;
- two tabs converging on canonical message order;
- disconnect during a response and SSE reconnect;
- duplicate message submission with one idempotency key;
- connector timeout and safe public error text;
- wrong origin, wrong site, and cross-tenant access rejection;
- keyboard use, narrow layout, and an axe accessibility scan;
- gateway response streaming with buffering disabled;
- logs and browser storage contain no bearer token, service secret, email, or private tool payload.

Start with `examples/local-chat`. Then test the deployed gateway against a non-production Chat Core
and agent before changing production DNS or traffic.

## Agentic integration with Codex or Claude

For a more complete task breakdown, including Cloudflare platform setup, multi-site provisioning,
and reusable frontend prompts, see [Agentic Cloudflare integration plan](agentic-cloudflare-integration-plan.md).

### Prepare the session

1. Put the target app and `formation-chat-core` in sibling folders or one workspace.
2. Open the target app as the working repository.
3. Give the agent read access to the Chat Core repository. Keep it read-only unless you want a
   coordinated change in both repositories.
4. Make the target app's repository instructions available. Codex reads `AGENTS.md`; Claude should
   receive the same rules through the repository's checked-in agent instructions or session
   context.
5. Do not paste production secrets into the prompt. Give variable names and use local placeholders.

In Codex, open the target repository in the desktop app and add the Chat Core checkout as another
workspace root when needed. In Claude, start the coding session in the target repository and grant
read access to the sibling Chat Core checkout using the tool's directory-access workflow.

### Planning prompt

Paste this first and replace the bracketed values:

```text
Plan a Formation Chat Core integration for this application.

Chat Core source and documentation are at: [PATH_TO_FORMATION_CHAT_CORE]
Target website origin: [HTTPS_ORIGIN]
Public site key: [SITE_KEY]
Trusted agent reference: [AGENT_REF]
Gateway choice: [EXISTING_HOST_BACKEND or CLOUDFLARE_WORKER]
Frontend: [REACT or OTHER]

Read this repository's agent instructions first. Then read Chat Core's AGENTS.md,
docs/PROJECT_BRIEF.md, accepted ADRs, docs/integrating-chat-core.md, the browser-client README,
the React UI README when relevant, and the Cloudflare example when selected.

Inspect the target app before proposing changes. Identify its package manager, server or edge
runtime, routing, authentication boundary, deployment configuration, tests, and existing UI
patterns. Do not edit files yet.

Return a small vertical-slice plan that covers:
- package delivery and versioning;
- tenant/site provisioning;
- a same-origin /v1 gateway with route and header allowlists;
- unbuffered SSE forwarding;
- browser client construction and UI mounting;
- origin, tenant, site, and secret isolation;
- local, integration, browser, and deployment verification.

Call out missing information and any change that would alter Chat Core's public contract.
```

Review the plan. Confirm the origin, widget key, trusted agent binding, gateway location, and
package source before allowing edits.

### Implementation prompt

```text
Implement the approved Chat Core integration plan in small vertical slices.

Constraints:
- Keep Formation Chat Core agent-runtime and UI-framework neutral.
- Do not change its public contract unless I explicitly approve that work.
- Never let browser input choose tenant, site, connector, agent URL, tenant key, or agent slug.
- Keep long-lived service credentials on the server or edge.
- Expose only the documented public chat routes.
- Strip untrusted forwarding, tenant, site, connector, agent, and service-token headers.
- Preserve Authorization, Idempotency-Key, Last-Event-ID, required content headers, and the exact
  allowed browser origin.
- Pass SSE response streams through without buffering.
- Use the official browser client for protocol state and the React ChatPanel when the app uses
  React.
- Do not log or persist browser bearer tokens, service credentials, contact values, or private tool
  payloads.

Write a failing test before each behavior change. After each slice, run its focused tests and keep
the target repository buildable. Match the target app's existing UI and accessibility patterns.
Document local setup, required environment variables, provisioning, deployment, rollback, and
verification. Do not commit, push, deploy, create cloud resources, or change production data unless
I ask separately.
```

### Review prompt

Use a fresh agent session or ask the same tool to review with a clean context:

```text
Review this Chat Core integration as a security-sensitive cross-repository change. Do not edit
files yet.

Check the diff and runtime path for:
- tenant and site isolation;
- browser-controlled connector or agent selection;
- leaked bearer tokens or service credentials;
- route or header forwarding that is broader than required;
- buffered or broken SSE reconnect behavior;
- missing idempotency headers;
- incorrect origin handling;
- duplicate client-side protocol state;
- inaccessible UI states;
- missing failure, reconnect, refresh-resume, and cross-scope tests;
- documentation that cannot be followed from a clean checkout.

Report actionable findings by severity with file and line references. If there are no findings,
list the commands and runtime checks that support that conclusion.
```

After addressing findings, run the target repository's full test, type-check, lint, build, browser,
and deployment-dry-run gates. Review the final diff for credentials and personal data.

## Production checklist

- Chat Core and PostgreSQL have backups, retention settings, metrics, and alerts.
- Chat Core is private or protected by authenticated ingress.
- The public gateway has exact hostname and origin mappings.
- Every widget has one trusted `agentRef`, or an explicit allowlist of public agent aliases, that
  exists in server connector configuration.
- The Haystack base URL and credentials are unavailable to browser code.
- Browser and gateway requests use HTTPS.
- SSE buffering is disabled at every proxy layer.
- Session and admin signing secrets are unique, stored outside Git, and rotatable.
- Package versions are pinned and upgrade ownership is clear.
- A staging test covers refresh, reconnect, duplicate writes, failure, and isolation before release.
