# Agentic Cloudflare integration plan

This document turns the Formation Chat Core deployment model into agent-ready work. Use it when an
AI coding agent needs to create the shared Cloudflare gateway, deploy the core, provision one or
more sites, and then integrate a chat UI into each target website repository.

## Confirmed model

Yes: one Chat Core deployment can serve multiple websites and their integrated chats.

The shared core is multi-tenant and site-aware. Each website gets a trusted site record with its own
`siteKey`, exact `allowedOrigins`, and `agentRef`. The core resolves the agent connector from trusted
server configuration, not from browser input. That means one core can safely route:

```text
www.example.com   -> siteKey example-main   -> agentRef support
docs.example.com  -> siteKey example-docs   -> agentRef docs-helper
www.other.com     -> siteKey other-main     -> agentRef sales
```

The important boundary is that every query, token, conversation, message, event, and connector run
stays scoped to the tenant and site selected by trusted configuration.

## End-to-end runtime shape

```text
browser chat UI
  -> same-origin /v1/* Cloudflare Worker gateway
  -> HTTPS Chat Core deployment
  -> trusted connector binding
  -> Haystack or another agent runtime
```

The Worker is stateless. It maps hostnames to site keys, validates origins, strips untrusted
headers, injects the Worker-held service credential, and streams SSE responses through unchanged.
The core remains the canonical store for sessions, conversations, messages, public events,
handoffs, and admin queries.

## Work breakdown

### Phase 1: Shared platform setup

Do this once per environment, such as staging and production.

#### Task 1: Deploy PostgreSQL and Chat Core

**Description:** Deploy the stateful Chat Core service with PostgreSQL, HTTPS ingress, migrations,
backups, retention, logs, and metrics.

**Inputs required:**

- `[ENVIRONMENT_NAME]`
- `[CHAT_CORE_BASE_URL]`, for example `https://chat-core.example.com`
- `[DATABASE_URL_SECRET_NAME]`
- `[SESSION_TOKEN_SECRET_NAME]`
- `[ADMIN_TOKEN_SECRET_NAME]`
- `[DEPLOYMENT_TARGET]`, such as Docker Compose, VM, Kubernetes, or managed container service

**Acceptance criteria:**

- Chat Core starts with production-strength secrets.
- Pending database migrations run successfully.
- `/health/live` and `/health/ready` behave as expected.
- The deployment has backup and restore instructions.
- Logs do not include bearer tokens, service credentials, contact values, or private tool payloads.

**Verification:**

- Run the repository gates relevant to the deployment.
- Run a clean-database migration test before production rollout.
- Confirm readiness from the private ingress and from the Worker-facing ingress.

#### Task 2: Configure trusted connector bindings

**Description:** Configure the connector map that resolves each trusted `agentRef` to a concrete
agent runtime. For Haystack compatibility, each binding fixes the Haystack base URL, tenant key,
agent slug, response mode, and timeout.

**Inputs required:**

- `[CONNECTOR_MODE]`, usually `haystack` or `mock`
- `[AGENT_REF]`
- `[HAYSTACK_BASE_URL]`
- `[HAYSTACK_TENANT_KEY]`
- `[HAYSTACK_AGENT_SLUG]`
- `[HAYSTACK_RESPONSE_MODE]`
- `[HAYSTACK_TIMEOUT_MS]`

**Acceptance criteria:**

- Browser requests cannot select connector URL, tenant key, agent slug, or response mode.
- Each `agentRef` maps to exactly one trusted connector binding.
- Connector failures become stable public errors without leaking private response bodies.

**Verification:**

- Submit a test user message through the core and confirm that it creates a run for the expected
  connector binding.
- Submit adversarial browser headers or body fields that try to change agent selection and confirm
  they are ignored or rejected.

#### Task 3: Provision tenants and sites

**Description:** Create the operator-controlled tenant and site records for every website that will
use the shared core.

**Inputs required per site:**

- `[TENANT_ID]`
- `[TENANT_DISPLAY_NAME]`
- `[SITE_ID]`
- `[SITE_DISPLAY_NAME]`
- `[SITE_KEY]`
- `[ALLOWED_ORIGIN]`, exact HTTPS origin such as `https://www.example.com`
- `[AGENT_REF]`

**Acceptance criteria:**

- Every site has one exact public origin or an explicit list of exact public origins.
- Every site has a trusted `agentRef`.
- Tenant and site provisioning is operator-controlled and not exposed to browsers.
- Site keys are unique enough to avoid operational confusion.

**Verification:**

- Bootstrap succeeds for the configured origin and site key.
- Bootstrap fails for wrong origin, unknown site key, and cross-tenant attempts.

#### Task 4: Create or update the Cloudflare Worker gateway

**Description:** Deploy the reference Cloudflare Worker gateway or adapt it into the website's
existing Cloudflare Worker. Public websites should use this same-origin gateway rather than direct
browser-to-core requests.

**Inputs required:**

- `[WORKER_NAME]`
- `[CHAT_CORE_BASE_URL]`
- `[HOSTNAME_TO_SITE_MAP]`
- `[CHAT_CORE_SERVICE_TOKEN_SECRET]`
- `[CLOUDFLARE_ACCOUNT_ID]`
- `[CLOUDFLARE_PROJECT_OR_ROUTE]`

**Required route allowlist:**

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

**Acceptance criteria:**

- The Worker resolves the site from the request hostname.
- The Worker injects the trusted site key into bootstrap requests.
- CORS returns the exact allowed origin, never `*`.
- Admin and identity-exchange routes are not exposed.
- Browser-supplied tenant, site, connector, agent, forwarding, and service-token headers are
  stripped.
- `Authorization`, `Idempotency-Key`, `Last-Event-ID`, `Accept`, and `Content-Type` are preserved
  where required.
- SSE responses are returned as streams, not buffered.
- The Worker secret is configured with `wrangler secret put` or equivalent secret management.

**Verification:**

- Run the Cloudflare Worker example tests.
- Run a Wrangler dry run.
- Use a browser or integration test to confirm that a streamed response arrives incrementally.
- Confirm wrong-origin and unknown-hostname requests fail.

#### Task 5: Protect the Chat Core origin

**Description:** Ensure the core origin is not a public unauthenticated backend that anyone can use
directly.

**Inputs required:**

- `[INGRESS_TYPE]`, such as reverse proxy, Cloudflare Tunnel, private network, mTLS, or service
  binding
- `[SERVICE_TOKEN_HEADER_OR_AUTH_METHOD]`

**Acceptance criteria:**

- The private ingress verifies the Worker-held origin credential.
- The credential is stripped before application logs.
- Direct unauthenticated requests to public chat routes are blocked.
- Admin APIs remain separately authenticated.

**Verification:**

- Request the core directly without the origin credential and confirm it fails.
- Request through the Worker and confirm the same public flow succeeds.

### Phase 2: Per-website frontend integration

Do this once for each website repository.

#### Task 6: Add package access for the browser client and optional UI package

**Description:** Make the target project consume `@formation-chat-core/browser-client` and,
when appropriate, `@formation-chat-core/ui-react` from an approved package source.

**Inputs required:**

- `[PACKAGE_SOURCE]`, such as monorepo workspace, internal npm registry, tarball artifact, or git
  package
- `[FRONTEND_FRAMEWORK]`
- `[PACKAGE_MANAGER]`

**Acceptance criteria:**

- The target project can install or link the browser client reproducibly.
- Versioning and update ownership are documented.
- The app does not copy compiled client files without an update plan.

**Verification:**

- Install dependencies from a clean checkout.
- Run the target app's typecheck or build.

#### Task 7: Create the Chat Core browser client

**Description:** Instantiate the protocol client in the target frontend using the website's own
origin as the transport base URL.

**Required behavior:**

```ts
import { createChatClient, createHttpChatTransport } from '@formation-chat-core/browser-client';

export const chatClient = createChatClient({
  siteKey: '[SITE_KEY]',
  transport: createHttpChatTransport({ baseUrl: window.location.origin }),
});
```

**Acceptance criteria:**

- The browser client owns bootstrap, session token handling, anonymous identity, selected
  conversation, event cursor, reconnects, idempotency keys, and snapshot recovery.
- The application does not persist the bearer token.
- The application does not duplicate protocol state in its own store.

**Verification:**

- First load creates or resumes an anonymous browser session.
- Refresh resumes the same selected conversation.
- Browser storage contains only the opaque anonymous identity, selected conversation ID, and event
  cursor data.

#### Task 8: Build or mount the chat UI

**Description:** Integrate either the reference React `ChatPanel` or a target-framework-specific UI
that subscribes to the browser client.

**Inputs required:**

- `[CHAT_ENTRY_POINT]`, such as floating launcher, inline support panel, docs helper, or full-page
  assistant
- `[UI_STYLE_REQUIREMENTS]`
- `[ACCESSIBILITY_REQUIREMENTS]`
- `[BRAND_REQUIREMENTS]`
- `[MESSAGE_RENDERING_REQUIREMENTS]`
- `[STRUCTURED_INPUT_REQUIREMENTS]`
- `[ERROR_AND_RECONNECT_COPY]`

**Acceptance criteria:**

- The UI can start a conversation, submit messages, render canonical messages, render streaming
  deltas, show loading and reconnect states, and submit structured input requests.
- Keyboard navigation, focus management, and narrow layouts work.
- Copy and visual design match the target website.
- The UI does not expose private connector details or raw tool payloads.

**Verification:**

- Run component tests where available.
- Run a browser smoke test for first message, streamed response, reconnect, refresh resume, and
  narrow viewport.
- Run an accessibility scan or the target project's standard accessibility checks.

#### Task 9: Add local and deployed configuration

**Description:** Document and wire local development, staging, and production settings for the
target website.

**Inputs required:**

- `[LOCAL_CHAT_CORE_URL_OR_PROXY]`
- `[STAGING_ORIGIN]`
- `[PRODUCTION_ORIGIN]`
- `[CLOUDFLARE_WORKER_ROUTE]`
- `[ENV_VAR_NAMES]`

**Acceptance criteria:**

- Local development can point to a local or staging gateway.
- Staging and production use exact configured origins.
- Required variables and secrets are documented without secret values.

**Verification:**

- A new developer or agent can run the website from a clean checkout using the documented setup.
- Staging deployment can complete a full chat round trip.

### Phase 3: Release and operations

#### Task 10: End-to-end release verification

**Description:** Validate the whole flow before production traffic.

**Acceptance criteria:**

- First anonymous session succeeds.
- First conversation and first streamed reply succeed.
- Refresh resume works.
- Two tabs converge on canonical message order.
- Disconnect and SSE reconnect work.
- Duplicate message submission with the same idempotency key does not duplicate messages.
- Wrong origin, wrong site, and cross-tenant access are rejected.
- Connector timeout shows safe public error text.
- Logs and browser storage do not contain bearer tokens, service secrets, contact values, or raw
  private tool payloads.

**Verification:**

- Save command output, test names, deployment URLs, and manual screenshots or traces in the
  implementation report.

#### Task 11: Rollback and monitoring

**Description:** Prepare rollback steps and production monitors.

**Acceptance criteria:**

- The Worker can be rolled back to the previous version.
- The website can disable or hide the chat entry point.
- Core deployment rollback and database migration policy are documented.
- Alerts cover core readiness, connector failures, elevated 4xx/5xx rates, SSE disconnect spikes,
  and latency.

**Verification:**

- Run a non-production rollback drill or document why it was deferred.

## Prompt: shared platform setup agent

Use this prompt in the Chat Core repository or infrastructure repository.

```text
You are implementing the shared Formation Chat Core platform setup.

Read repository instructions first. Then read:
- docs/PROJECT_BRIEF.md
- docs/IMPLEMENTATION_PLAN.md
- every accepted ADR in docs/decisions/
- docs/integrating-chat-core.md
- docs/agentic-cloudflare-integration-plan.md
- docs/operations/*
- examples/cloudflare-worker/README.md
- examples/cloudflare-worker/src/index.ts

Goal:
Deploy or prepare deployment artifacts for one shared Chat Core environment and its Cloudflare
Worker gateway.

Environment:
- Environment name: [ENVIRONMENT_NAME]
- Chat Core base URL: [CHAT_CORE_BASE_URL]
- Deployment target: [DEPLOYMENT_TARGET]
- Database provider: [DATABASE_PROVIDER]
- Ingress type: [INGRESS_TYPE]
- Cloudflare account/project/route: [CLOUDFLARE_TARGET]

Sites to provision:
[REPEAT THIS BLOCK PER SITE]
- Tenant ID: [TENANT_ID]
- Tenant display name: [TENANT_DISPLAY_NAME]
- Site ID: [SITE_ID]
- Site display name: [SITE_DISPLAY_NAME]
- Public hostname: [PUBLIC_HOSTNAME]
- Allowed origin: [ALLOWED_ORIGIN]
- Site key: [SITE_KEY]
- Agent ref: [AGENT_REF]

Connector bindings:
[REPEAT THIS BLOCK PER AGENT_REF]
- Agent ref: [AGENT_REF]
- Connector mode: [CONNECTOR_MODE]
- Haystack base URL: [HAYSTACK_BASE_URL]
- Haystack tenant key: [HAYSTACK_TENANT_KEY]
- Haystack agent slug: [HAYSTACK_AGENT_SLUG]
- Haystack response mode: [HAYSTACK_RESPONSE_MODE]
- Timeout ms: [HAYSTACK_TIMEOUT_MS]

Constraints:
- One shared core may serve many websites, but every request and mutation must preserve tenant and
  site isolation.
- Browser input must never select tenant, site, connector URL, tenant key, agent slug, or response
  mode.
- Use ordinary HTTP writes and SSE streaming.
- Keep the Worker stateless.
- Keep service credentials out of browser code and logs.
- Expose only the public chat route allowlist.
- Pass SSE response streams through without buffering.
- Do not change Chat Core's public contract unless explicitly approved.
- Do not paste or commit production secrets.

Implement in small vertical slices:
1. Inspect current deployment, package, and Cloudflare configuration.
2. Produce a short plan if any required input is missing.
3. Add or update deployment config and provisioning scripts.
4. Add or update Cloudflare Worker configuration.
5. Add tests or smoke checks for route allowlisting, origin handling, header stripping, bootstrap,
   and SSE streaming.
6. Run relevant tests, typechecks, builds, and deployment dry runs.
7. Document exact setup, secret names, deployment commands, rollback, and verification evidence.

Stop before any production deploy, DNS change, database mutation, or secret creation unless I
explicitly authorize that action.
```

## Prompt: target frontend integration agent

Use this prompt in each website repository.

```text
You are integrating Formation Chat Core into this website.

Read this repository's agent instructions first. Then read the Chat Core documentation at:
[PATH_TO_FORMATION_CHAT_CORE]

Required Chat Core docs:
- AGENTS.md
- docs/PROJECT_BRIEF.md
- every accepted ADR in docs/decisions/
- docs/integrating-chat-core.md
- docs/agentic-cloudflare-integration-plan.md
- packages/browser-client/README.md
- packages/ui-react/README.md when this app uses React
- examples/cloudflare-worker/README.md when this app owns the Cloudflare Worker

Target website:
- Production origin: [PRODUCTION_ORIGIN]
- Staging origin: [STAGING_ORIGIN]
- Frontend framework: [FRONTEND_FRAMEWORK]
- Package manager: [PACKAGE_MANAGER]
- Package source for Chat Core client: [PACKAGE_SOURCE]
- Same-origin gateway path: /v1/*
- Site key: [SITE_KEY]
- Agent ref, for documentation only: [AGENT_REF]

UI requirements:
- Chat entry point: [CHAT_ENTRY_POINT]
- Placement and responsive behavior: [PLACEMENT_AND_RESPONSIVE_BEHAVIOR]
- Visual style requirements: [VISUAL_STYLE_REQUIREMENTS]
- Brand or tone requirements: [BRAND_OR_TONE_REQUIREMENTS]
- Welcome message: [WELCOME_MESSAGE]
- Suggested prompts: [SUGGESTED_PROMPTS]
- Message rendering requirements: [MESSAGE_RENDERING_REQUIREMENTS]
- Citation rendering requirements: [CITATION_RENDERING_REQUIREMENTS]
- Tool status rendering requirements: [TOOL_STATUS_RENDERING_REQUIREMENTS]
- Structured input/contact request behavior: [STRUCTURED_INPUT_REQUIREMENTS]
- Empty, loading, reconnect, failure, and offline states: [STATE_COPY_AND_BEHAVIOR]
- Accessibility requirements: [ACCESSIBILITY_REQUIREMENTS]
- Analytics requirements, if any: [ANALYTICS_REQUIREMENTS]

Constraints:
- Use @formation-chat-core/browser-client for protocol state.
- Use createHttpChatTransport({ baseUrl: window.location.origin }) unless the approved gateway
  design says otherwise.
- Do not persist or expose the short-lived bearer token.
- Do not duplicate Chat Core protocol state in application stores.
- Do not let the browser choose tenant, site, connector, agent URL, tenant key, agent slug, or
  response mode.
- Do not log contact values, bearer tokens, service credentials, or private tool payloads.
- Preserve the target app's existing design system and accessibility patterns.
- Keep changes small and verifiable.

First, inspect the target app and return a concise implementation plan. After I approve it,
implement in slices:
1. Add package access for the Chat Core client and optional React UI.
2. Create a small chat client module using the configured site key and same-origin transport.
3. Mount or build the chat UI according to the requirements above.
4. Add local and deployed configuration docs.
5. Add focused tests for startup, first message, refresh resume, reconnect/error states, and any
   custom rendering.
6. Run the target app's relevant test, lint, typecheck, and build commands.
7. Report files changed, verification evidence, remaining risks, and any manual Cloudflare or
   secret steps.

Do not deploy, commit, push, create cloud resources, or change production data unless I ask
separately.
```

## Prompt: security review agent

Use this prompt after implementation, ideally in a fresh session.

```text
Review this Formation Chat Core integration as a security-sensitive cross-repository change.
Do not edit files yet.

Read:
- Chat Core docs/PROJECT_BRIEF.md
- Chat Core accepted ADRs
- Chat Core docs/integrating-chat-core.md
- Chat Core docs/agentic-cloudflare-integration-plan.md
- The target repository diff

Check for:
- tenant and site isolation failures;
- browser-controlled connector or agent selection;
- leaked bearer tokens or service credentials;
- route or header forwarding broader than required;
- buffered or broken SSE reconnect behavior;
- missing idempotency headers;
- incorrect origin handling;
- duplicated protocol state outside the browser client;
- inaccessible UI states;
- missing tests for refresh resume, reconnect, streaming, first message, and cross-scope rejection;
- documentation that cannot be followed from a clean checkout.

Report actionable findings by severity with file and line references. If there are no findings,
say that clearly and list residual risks or manual verification still needed.
```

