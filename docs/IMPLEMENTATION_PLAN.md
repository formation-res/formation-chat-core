# Formation Chat Core implementation plan

## Purpose

Build the first self-hosted release in small, verifiable slices. Each task should leave the
repository working. Do not start the polished UI, dashboard, or native Haystack changes before the
protocol and reconnect path have been proven.

The commands below are targets. Task 1 must define the actual toolchain and make the root commands
work.

## Dependency outline

```text
Toolchain
  -> shared protocol
      -> persistence
          -> anonymous session
              -> conversations and messages
                  -> event replay and SSE
                      -> connector runtime and mock
                          -> browser client
                              -> reference UI
                              -> Cloudflare example
                          -> Haystack compatibility connector
                              -> native Haystack streaming endpoint
                                  -> email handoff
          -> admin queries
              -> dashboard
  -> security and release checks apply throughout
```

## Phase 1: Contract foundation

### Task 1: Select and configure the TypeScript toolchain

**Description:** Choose the package manager behavior, TypeScript version, server framework, schema
tool, database library, migration tool, linter, formatter, and test runner. Record expensive choices
in ADR-005. Add only the root configuration needed to build an empty protocol package.

**Acceptance criteria:**

- Root `build`, `test`, `lint`, and `typecheck` commands run successfully.
- Node and package-manager versions are pinned or clearly constrained.
- ADR-005 explains the selected libraries, alternatives, and consequences.
- No production endpoint or speculative framework wrapper is added.

**Verification:**

```bash
npm install
npm run build
npm test
npm run lint
npm run typecheck
```

**Dependencies:** None

**Files likely touched:** `package.json`, lockfile, root TypeScript config, lint config,
`packages/protocol/package.json`, `docs/decisions/005-toolchain.md`

**Estimated scope:** Medium

**Completed:** 2026-07-15 in `355b78e`. Clean install resolved with zero vulnerabilities; build,
test, lint, formatting, and type checking passed.

### Task 2: Define common protocol primitives

**Description:** Define language-neutral schemas for opaque IDs, timestamps, cursor pagination,
error envelopes, idempotency metadata, event envelopes, and visibility. Generate or validate the
TypeScript representations from the schemas.

**Acceptance criteria:**

- All resources use the same identifier, time, pagination, and error conventions.
- Event envelopes include event ID, sequence, type, timestamp, visibility, conversation ID, and
  optional run/message correlation IDs.
- Unknown additive fields have a documented compatibility rule.

**Verification:** Run schema fixture tests, type checking, and a generated-artifact drift check.

**Dependencies:** Task 1

**Files likely touched:** `packages/protocol/src/common/*`, `packages/protocol/test/common.*`, protocol
package scripts

**Estimated scope:** Medium

**Completed:** 2026-07-15 in `fd3d304`. Schema fixture tests, generated-artifact drift checking,
build, lint, formatting, and type checking passed.

### Task 3: Define identity and session contracts

**Description:** Specify tenants, sites, anonymous principals, externally authenticated principals,
browser sessions, identity assertions, access scopes, and bootstrap responses.

**Acceptance criteria:**

- The anonymous flow cannot claim an external user ID.
- An authenticated identity assertion contains issuer, audience, subject, expiry, and nonce.
- Session tokens are scoped to tenant, site, principal, and allowed operations.
- Browser-controlled fields cannot override trusted site or connector configuration.

**Verification:** Valid and adversarial schema fixtures pass, including expiry, wrong audience, and
cross-site identity cases.

**Dependencies:** Task 2

**Files likely touched:** `packages/protocol/src/identity/*`, `packages/protocol/test/identity.*`,
protocol documentation

**Estimated scope:** Medium

**Completed:** 2026-07-15 in `4d39ee6`. Valid and adversarial identity fixtures covered trusted
field overrides, expiry, audience, tenant/site isolation, token scope, and credential leakage; all
repository gates passed.

### Task 4: Define conversation, message, run, and event contracts

**Description:** Specify conversations, participants, message lifecycle, discriminated content
parts, agent runs, tool status, citations, structured inputs, handoffs, and connector events.

**Acceptance criteria:**

- V1 models one user and one agent while allowing additive participant kinds later.
- Message parts distinguish text, citation, file reference, tool status, and structured input.
- Raw reasoning and unrestricted tool payloads have no public content-part schema.
- Every connector event has explicit visibility and correlation fields.
- OpenAPI describes the proposed public endpoints and stable error responses.

**Verification:** Contract fixtures cover a normal streamed reply, failure, reconnect, citation,
tool status, contact request, and completed handoff.

**Dependencies:** Tasks 2 and 3

**Files likely touched:** `packages/protocol/src/chat/*`, `packages/protocol/openapi/*`, fixtures and
contract tests

**Estimated scope:** Medium, split message and event schemas if it exceeds five focused files

**Completed:** 2026-07-15 in `6252c2b`. Contract fixtures cover streaming, failure, reconnect,
citation, tool status, contact request, handoff, public/private separation, trusted correlation,
and adversarial payloads. OpenAPI 3.1.1, generated-schema drift, TypeScript consumers, and a Python
Draft 2020-12 validator passed with all repository gates.

### Checkpoint: Contract review

- All schemas validate independently of server code.
- A TypeScript consumer can import generated or validated types.
- A Python fixture can validate a connector event from the published JSON Schema.
- Project owner reviews endpoint names, event semantics, and public/private visibility.

## Phase 2: Durable chat vertical slice

### Task 5: Add the server shell and PostgreSQL persistence base

**Description:** Add configuration validation, database connection handling, migrations, health
checks, request correlation, and a minimal server entry point. Implement tenant and site records
needed by bootstrap.

**Acceptance criteria:**

- A clean PostgreSQL database migrates to the expected schema.
- Migrations are repeatable and have a documented rollback policy.
- Liveness and readiness distinguish process health from database availability.
- Configuration errors fail at startup without printing secrets.

**Verification:** Container smoke test, clean-database migration test, and configuration tests.

**Dependencies:** Task 4

**Files likely touched:** `apps/server/src/*`, migration files, server package metadata, Compose
configuration, server tests

**Estimated scope:** Medium, split setup and first migration into separate commits

**Completed:** 2026-07-15 in `9212b30` and `f0cefb2`. The Fastify health shell, validated
configuration, PostgreSQL/Kysely lifecycle, repeatable tenant/site migration, safe startup,
container image, Compose environment, and rollback policy are implemented. Unit gates, a clean
PostgreSQL migration integration test, and an image-internal readiness smoke test passed.

### Task 6: Implement anonymous session bootstrap

**Description:** Create or resume an anonymous principal and browser session for a trusted site.
Issue a short-lived scoped token. Do not create a conversation during bootstrap.

**Acceptance criteria:**

- Repeated bootstrap with the same trusted browser identity resumes the principal.
- A new browser identity creates a new principal.
- Tokens cannot cross tenant or site boundaries.
- Service credentials and raw identity assertions never appear in responses or logs.

**Verification:** API integration tests for create, resume, expiry, wrong site, wrong origin, and
tampered token.

**Dependencies:** Tasks 3 and 5

**Files likely touched:** session route, session service, session repository, auth middleware,
integration tests

**Estimated scope:** Medium

**Completed:** 2026-07-15 in `54db923`. Anonymous bootstrap now resolves trusted site settings,
enforces browser origins, creates or resumes principals and sessions, replays idempotent resource
identity, and issues short-lived tenant/site-scoped tokens. Clean PostgreSQL API tests cover create,
resume, new browser identity, expiry, unknown site, wrong origin, missing or reused idempotency keys,
cross-site verification, and token tampering. All repository gates passed.

### Task 7: Implement conversations and idempotent user messages

**Description:** Add conversation creation, conversation lookup, message submission, message
pagination, deterministic ordering, and idempotency records.

**Acceptance criteria:**

- A principal sees only conversations allowed by its scoped token.
- Retrying the same idempotency key returns the original result without a duplicate message.
- Reusing a key with a different payload returns a conflict.
- Concurrent messages receive a deterministic order.
- List endpoints use cursor pagination from the first release.

**Verification:** Contract, authorization, concurrency, pagination, and idempotency integration
tests.

**Dependencies:** Tasks 5 and 6

**Files likely touched:** conversation route, conversation service, message service, repositories,
integration tests

**Estimated scope:** Medium, split conversations and messages if needed

**Completed:** 2026-07-15 in `49d5a05`, `30ccc5e`, and `b717b0c`. PostgreSQL now stores scoped
conversations, participants, messages, and command idempotency records. Public APIs create, fetch,
and cursor-page conversations; accept and cursor-page user messages; replay matching retry keys;
reject changed-payload reuse; and allocate contiguous message sequences under concurrent writes.
Authorization, pagination, idempotency, and tenant/site/principal isolation passed 20 PostgreSQL
integration tests. Build, type checking, unit tests, contract drift checks, lint, formatting, and
the dependency audit passed.

### Task 8: Implement the ordered event store and SSE replay

**Description:** Persist conversation events, publish them live over SSE, replay after a cursor,
and fall back to a canonical snapshot when retained deltas are unavailable.

**Acceptance criteria:**

- Events have increasing per-conversation sequence values under concurrent writes.
- `Last-Event-ID` resumes after the last delivered event without duplication.
- Slow clients do not block database transactions or agent execution.
- An expired cursor receives `sync.required` and can recover through normal query endpoints.
- Completed message state remains available if transient delta events are pruned later.

**Verification:** Disconnect/reconnect, concurrent subscriber, slow-client, retention, and snapshot
recovery tests.

**Dependencies:** Task 7

**Files likely touched:** event repository, event service, SSE route, retention configuration,
integration tests

**Estimated scope:** Medium and risk-first

**Completed:** 2026-07-15 in `020edea` and `cb93802`. PostgreSQL stores scoped events with a
gap-free per-conversation sequence and configurable count retention. The SSE endpoint replays
public events after `Last-Event-ID`, fans out live events through bounded subscriber queues, and
returns `sync.required` for expired cursors or slow clients. Tests cover concurrent writes,
visibility and tenant isolation, reconnect without duplication, concurrent subscribers,
backpressure overflow, retention, and recovery from canonical messages.

### Task 9: Add connector execution and a deterministic mock connector

**Description:** Define the in-process connector SDK, validate all connector events, run connector
jobs outside the request transaction, and provide a mock connector for deterministic tests and
examples.

**Acceptance criteria:**

- A submitted user message schedules exactly one agent run.
- The mock connector produces streamed text, tool status, citation, success, and configurable
  failure scenarios.
- Connector retries cannot create duplicate assistant messages.
- Invalid or private connector payloads do not enter the public stream.
- Cancellation has an explicit best-effort status.

**Verification:** End-to-end mock conversations for success, connector failure, process restart,
retry, and cancellation.

**Dependencies:** Tasks 4 and 8

**Files likely touched:** `packages/server-sdk/*`, `connectors/mock/*`, server run worker, connector
event validator, integration tests

**Estimated scope:** Medium, use separate commits for SDK and mock implementation

**Completed:** 2026-07-15 in `d222e7a`, `d82ab01`, `96a2052`, `cd7e168`, `4f72e56`, and
`fe131da`. The
connector SDK defines a vendor-neutral async event boundary, and the deterministic mock covers
success and failure output. User-message transactions schedule one durable run. PostgreSQL leases
support restart recovery and renew leases during long calls. Stable assistant message IDs prevent
duplicate transcript entries on retry. Connector output is validated before storage, private visibility stays out of SSE, and
the scoped idempotent cancellation API interrupts active in-process connectors on a best-effort
basis. Local Compose runs the mock worker; the server default leaves connector execution disabled.

### Checkpoint: Headless chat

- A test client creates an anonymous session and conversation.
- A user message streams a mock response and survives reconnect.
- Restarting the server does not lose final message or run state.
- Duplicate commands and connector retries do not duplicate transcript content.

## Phase 3: Browser and website integration

### Task 10: Build the framework-neutral browser client

**Description:** Implement bootstrap, conversation commands, SSE subscription, cursor persistence,
deduplication, snapshot sync, cancellation, retry, and typed state updates without rendering UI.

**Acceptance criteria:**

- The client exposes transport-independent state and actions.
- Refresh resumes the anonymous principal and selected conversation in the same browser.
- Multiple tabs converge on the same canonical message order.
- `sync.required` recovery is automatic and testable.
- Host applications can provide their own storage and fetch adapters where needed.

**Verification:** Unit tests with a fake transport plus browser integration tests against the mock
connector.

**Dependencies:** Tasks 6 through 9

**Files likely touched:** `packages/browser-client/src/*`, browser-client tests and package metadata

**Estimated scope:** Medium, split protocol transport from state management

**Completed:** 2026-07-15 in `6910c74` and `b5a8778`. The framework-neutral client now owns typed
state, canonical ordering, transient stream state, anonymous resume, cursor persistence,
idempotent commands, cancellation, retry, automatic snapshot recovery, bounded reconnection, and
multi-tab convergence through injectable storage. The validated fetch/SSE transport keeps bearer
tokens in memory, supports custom fetch adapters, cursor-pages all messages, and rejects invalid
or oversized event frames. Fifteen unit tests and a real Chrome test against PostgreSQL and the
deterministic mock connector passed, including refresh resume and two-tab convergence.

### Task 11: Build a minimal accessible reference UI

**Description:** Add a simple modern chat UI as a thin layer over the browser client. Implement the
React package first, then add the Web Component wrapper only if it can reuse the same state model.

**Acceptance criteria:**

- UI covers empty, loading, streaming, completed, retry, failed, reconnecting, and handoff states.
- Composer, transcript, live status, and structured email input work with keyboard and screen
  readers.
- Integrators can replace message rendering and styling without forking protocol logic.
- Haystack-specific fields and behavior do not appear in UI props.

**Verification:** Component tests, real-browser accessibility checks, narrow and wide viewport
screenshots, and successful mock conversation flow.

**Dependencies:** Task 10

**Files likely touched:** `packages/ui-react/*`, optional `packages/ui-web-component/*`, static
example files, browser tests

**Estimated scope:** Medium per UI package; do not combine both packages in one task if large

**Completed:** 2026-07-15 in `5a7671c`. The React package provides accessible empty, loading, streaming,
completed, failed, retry, reconnecting, structured email, and handoff states; protocol-neutral
render hooks; and optional low-specificity styles. Eight component tests pass, including axe and
unsafe-link checks. A real Chrome smoke test passes keyboard submission, axe, completion, and
contact-to-handoff checks with a clean console; 1024-pixel and 320-pixel screenshots were reviewed.
The Web Component wrapper remains deliberately deferred until a concrete reuse need appears.

### Task 12: Add the Cloudflare Worker gateway example

**Description:** Provide a stateless gateway that maps a site hostname to trusted configuration,
keeps the core service credential in a Worker secret, restricts allowed paths and methods, and
passes SSE response bodies without buffering.

**Acceptance criteria:**

- No long-lived service credential reaches the browser bundle or response.
- Requests from unknown sites or origins are rejected.
- The gateway strips untrusted forwarding, tenant, site, connector, and agent headers.
- Request sizes and allowed content types are constrained.
- SSE arrives incrementally through the Worker.

**Verification:** Worker unit tests, local runtime integration test, secret scan, and deployed preview
smoke test when credentials are available.

**Dependencies:** Tasks 6, 8, and 10

**Files likely touched:** `examples/cloudflare-worker/*`, deployment guide, static website example

**Estimated scope:** Medium

**Completed:** 2026-07-15 in `5a7671c`. The stateless Worker resolves trusted site configuration from the public
hostname, enforces configured origins (with a same-origin Fetch Metadata fallback) and a public
path/method allowlist, limits JSON writes to 128 KiB,
reconstructs upstream headers, injects a required secret origin credential, and passes upstream
response streams through unchanged. The example bundles the React reference UI as same-origin
Cloudflare static assets with restrictive response headers. Seven unit contracts, a local workerd SSE
integration test, generated-binding drift check, type checking, linting, build, startup analysis,
secret scan, and Wrangler deployment dry run pass. A deployed preview smoke test remains conditional
on project credentials and a configured preview origin.

**Direct-widget follow-up:** 2026-07-20. `examples/direct-chat-widget` provides a deliberately
smaller pilot path for one trusted Haystack agent: a Cloudflare Worker, an embeddable accessible Web
Component, same-browser local history, and no Chat Core or PostgreSQL deployment. Mock mode supports
credential-free preview testing; each production site uses the same code in a separately named
Worker whose dashboard-managed bindings fix the allowed origin, Haystack tenant, and agent while a
Worker secret holds the connector token. Deployments preserve those per-Worker values and stream
native connector SSE events without buffering. This is an optional pilot, not a replacement for the canonical-store
architecture when durable transcripts, retries, admin queries, or handoffs are required.
Unit, generated-type, lint, build, local workerd, axe, refresh-persistence, narrow-layout, Wrangler
dry-run, startup, public HTTP, public SSE, and deployed-browser smoke checks pass. The credential-free
mock preview is deployed on Cloudflare; production Haystack configuration remains intentionally
unset until the first website and agent are selected.

**Runtime fix:** 2026-07-21. Outbound Haystack requests use manual redirect handling because the
Cloudflare runtime rejects `redirect: "error"`; non-success redirects remain unavailable responses
and are never followed with the connector bearer token. A regression assertion covers the runtime-safe mode.

### Checkpoint: Public website

- A static website can embed the reference UI or browser client.
- Anonymous history survives refresh in the same browser.
- The Cloudflare gateway preserves streaming and hides service credentials.
- Direct integration and gateway integration are both documented.

## Phase 4: Haystack and human handoff

### Task 13: Implement the Haystack compatibility connector

**Description:** Call Formation Haystack's existing synchronous knowledge-chat endpoint. Map core
IDs to trusted Haystack fields and translate the response text, metadata, citations, tools, and
handoff request into generic events.

**Acceptance criteria:**

- Tenant and agent references come from connector configuration, not browser input.
- `principalId` maps to `user_id`; `conversationId` maps to `thread_id`.
- Core run and message IDs appear in Haystack metadata for correlation.
- A timeout or invalid response produces a failed run without corrupting the transcript.
- Temporary duplicate-history behavior is documented and observable.

**Verification:** Contract test against the current `haystack-mailagent` API plus mock timeout,
invalid-response, and handoff fixtures.

**Dependencies:** Task 9

**Files likely touched:** `connectors/haystack/*`, connector configuration schemas, integration tests,
Haystack integration guide

**Estimated scope:** Medium

**Completed:** 2026-07-16 in `a4fd3f7`, `b562eb3`, `da64c30`, and `536c282`. The synchronous
connector maps trusted agent bindings to Haystack tenant and agent fields, principal and
conversation IDs to user and thread fields, and core correlation IDs into request metadata. It
validates bounded requests and responses before starting an assistant message, translates text,
tools, citations, and handoff requests into generic events, and exposes the temporary
duplicate-history mode in stored Haystack metadata. Eight connector tests cover success, timeout,
malformed and invalid responses, rejected runs, aggregate request bounds, handoff, and
configuration safety. Generated JSON Schemas are drift-checked, the reference server resolves only
explicit agent bindings, and the cross-repository check passes against the current
`haystack-mailagent` FastAPI OpenAPI contract.

### Task 14: Add the native streaming connector endpoint to Haystack

**Description:** In the separate `haystack-mailagent` repository, add a versioned endpoint that
accepts normalized history from the core and streams generic connector events. Preserve existing
email, Zulip, playground, and synchronous API behavior.

**Acceptance criteria:**

- Web-chat execution does not require Haystack to load its local web transcript.
- Existing channels and tests remain unchanged unless the migration plan calls for an additive
  update.
- Tool progress, citations, completion, failure, and handoff events validate against the published
  connector schemas.
- Correlation IDs link chat-core runs to Haystack traces.

**Verification:** Haystack unit and API tests, cross-repository contract fixtures, streaming
disconnect test, and backward-compatibility tests for the old endpoint.

**Dependencies:** Tasks 4 and 13

**Files likely touched:** Haystack request models, agent service, new API route, event adapter, tests

**Estimated scope:** Medium in the Haystack repository, delivered through its own branch and review

**Completed:** 2026-07-16 on Haystack branch `codex/task-14-haystack-streaming` in `733ca8b`,
`0811739`, `41151d6`, and `a02cc82`, with chat-core contract support in `4ca52eb` and `8a9d1b8`.
The token-authenticated `POST /api/connectors/v1/runs` endpoint accepts the published execution
envelope, runs solely from normalized supplied history, and streams bounded public SSE connector
events with stable core correlation IDs. Tool, citation, completion, failure, and handoff output is
validated against chat-core's generated JSON Schema; citation credentials and provider failures are
kept out of public output. Haystack's 137 tests pass, including disconnect propagation and the old
synchronous endpoint, along with Ruff lint, changed-file formatting, package build, and the live
cross-repository fixture gate. Repository-wide Ruff formatting still reports 26 pre-existing
unformatted files outside this task.

### Task 15: Implement structured contact collection and email handoff

**Description:** Add the generic contact-request lifecycle in the core and extend Haystack's
handoff behavior to create a short call, summarize the conversation, send to the configured target,
and CC the visitor.

**Acceptance criteria:**

- Missing contact information produces a typed email request and pauses the handoff workflow.
- The core validates the email and records purpose-specific consent before resuming the run.
- The handoff target comes only from trusted Haystack agent configuration.
- The email contains a concise handoff call and useful conversation summary.
- The visitor is CC'd, headers are sanitized, and retries use a stable delivery idempotency key.
- Public events reveal status without exposing provider credentials or internal errors.

**Verification:** Browser contact-input test; valid, invalid, and declined contact tests; successful
delivery; transient retry; permanent failure; duplicate delivery; and header-injection tests.

**Dependencies:** Tasks 9, 11, and 14

**Files likely touched:** core input and handoff services, reference UI input renderer, Haystack
handoff tool, outbound delivery path, cross-repository tests

**Estimated scope:** Split into core contact lifecycle and Haystack delivery tasks before coding

**Completed:** 2026-07-16 in chat-core commits `06552d0`, `2274c49`, and `c94bb84`, plus Haystack
commit `427a54d` on branch `codex/task-15-email-handoff`. Chat Core now persists scoped handoff and structured-input resources,
pauses runs for typed email input, records purpose-bound consent or decline decisions, and resumes
the same run with private `resolvedInputs`. The browser client and React UI submit the validated,
idempotent command without retaining contact data. Haystack pauses after `contact.requested`, then
uses trusted agent sender/target configuration to send a bounded deterministic transcript summary,
CC the consented visitor, and emit only generic outcomes. SQLite delivery state and a stable
run-derived message ID prevent duplicate delivery and permit transient retries. Tests cover valid,
invalid, declined, isolated, successful, transient, permanent, duplicate, contract, and header
injection paths.

### Checkpoint: Production agent path

- Cloudflare-hosted site streams a Haystack answer through the core.
- Public tool and citation events render without private payloads.
- A handoff collects consented contact data and sends one tracked email to the configured target
  with the visitor in CC.
- Core and Haystack dashboards can correlate the run through stable IDs.

## Phase 5: Operations and release

### Task 16: Add admin query APIs

**Description:** Implement separately authenticated, cursor-paginated admin endpoints for
conversations, messages, event timelines, connector runs, failures, and handoffs.

**Acceptance criteria:**

- Admin authorization is separate from visitor session authorization.
- Operator and internal visibility are enforced by scope.
- Filters cover tenant, site, agent reference, status, date, and handoff state.
- Admin queries never require direct access to Haystack storage.

**Verification:** Authorization matrix, pagination, filtering, redaction, and tenant-isolation tests.

**Dependencies:** Tasks 7 through 9 and Task 15 for complete handoff views

**Files likely touched:** admin routes, admin query service, repositories, authorization policy,
integration tests

**Estimated scope:** Medium, split conversation and run/handoff queries if needed

**Completed:** 2026-07-16 in `2298791`, `061d6bd`, `7917446`, and `35bb9fc`. The separately signed
admin JWT
binds each operator to one tenant, an explicit site set, and operator or internal read visibility.
The `/v1/admin` namespace cursor-pages canonical conversations, messages, retained event timelines,
connector runs, failures, and handoffs with site, agent, status, and date filters; tenant filtering
is mandatory in token claims. Database queries enforce scope before resource lookup, failure output
contains only stable codes, and handoff output excludes contact values. Composite indexes support
the new access paths. Contract, authorization, visibility, pagination, filter, redaction, and
cross-tenant/site integration tests pass.

### Task 17: Build the read-only operations dashboard

**Description:** Build a separate UI over the admin API for transcript inspection, run timelines,
connector health, failures, retries, and pending handoffs.

**Acceptance criteria:**

- The UI clearly distinguishes public transcript, operator metadata, and internal diagnostics.
- Correlation links connect conversation, message, run, handoff, and external trace IDs.
- The dashboard does not configure Haystack agents or read Haystack's database.
- Empty, loading, failure, and large-history states are usable.

**Verification:** Component tests, browser tests with realistic fixtures, authorization checks, and
mobile and desktop visual review.

**Dependencies:** Task 16

**Files likely touched:** `apps/dashboard/*`, admin client package if justified, browser tests

**Estimated scope:** Multiple medium vertical slices, starting with conversation inspection

**Completed:** 2026-07-16 in `9d9fe27` and `d43201b`. The standalone React dashboard uses only the
scoped admin API and keeps operator bearer tokens in memory. It provides searchable conversation inspection,
public transcript and visibility-labelled event timelines, expandable run/failure/handoff lists,
and navigable conversation, message, run, handoff, principal, and event correlations. The core run
ID is the cross-system trace key supplied to connectors; when no separate connector trace ID is
present, the UI states that explicitly. Cursor continuation handles large transcript histories.
Light and dark themes, reduced-motion support, responsive desktop/mobile layouts, skeletons,
disabled/loading/error/empty states, and WCAG contrast are covered by component and real-browser
tests with realistic fixtures.

### Task 18: Harden and document the first release

**Description:** Complete rate limits, request limits, audit events, PII retention, deletion,
redaction, secret rotation, backups, restore procedures, observability, and release documentation.

**Acceptance criteria:**

- Tenant, site, principal, and admin isolation pass adversarial tests.
- Logs contain no access tokens, service secrets, visitor email, or raw private tool payloads.
- Anonymous and authenticated retention policies are configurable and documented.
- Backup and restore are tested against a representative database.
- Connector and email side effects remain idempotent after process restart.
- Quick starts cover mock, direct website, Cloudflare, authenticated app, and Haystack deployments.

**Verification:** Full test suite, type checking, linting, production build, dependency audit, secret
scan, backup/restore drill, and documented end-to-end release checklist.

**Dependencies:** All preceding tasks

**Files likely touched:** security policy, operations guides, deployment configuration, CI workflow,
end-to-end tests

**Estimated scope:** Break into security, operations, documentation, and release tasks

**Completed:** 2026-07-16 in `1247289` and `ac23d0a`. The release runtime now enforces configurable
body, timeout, proxy-trust, and bounded bootstrap/public/admin rate limits; emits defensive API
headers; writes payload-free tenant/site-aware audit events; sanitizes request logs; exposes
low-cardinality metrics behind a separate credential; and supports bounded previous signing keys
for zero-downtime session/admin rotation. A scheduled, bounded retention worker redacts submitted
contact values and removes expired anonymous transcripts and principals in scoped transactions.
Authenticated-principal retention is configured for the identity-exchange path but remains dormant
until that v1 host-auth boundary is implemented. PostgreSQL backup/restore scripts, threat and
retention guidance, observability/rollback checklists, five deployment quick starts, and CI gates
complete the operations slice. Unit/workspace suites, 50 PostgreSQL integration tests, the current
Haystack contract, Cloudflare workerd streaming, generated-contract checks, type checking, linting,
production builds, a zero-vulnerability production dependency audit, Gitleaks, and a representative
16-table/8-migration backup-and-restore drill pass.

**CI follow-up:** 2026-07-16. Workspace execution now follows package dependency order, and CI
builds workspace entry points before importing them in tests. A clean-tree build followed by all
workspace tests, type checking, linting, and formatting passes.

**Local integration follow-up:** 2026-07-16. `examples/local-chat` now provides the React reference
UI through a loopback-only, same-origin streaming proxy with validated configuration and automatic
local tenant/site provisioning. It documents mock and Haystack runs. The integration guide covers
manual implementation and reviewed Codex or Claude workflows for another app or website.

The follow-up now also includes a supervised `dev:local` stack: it owns PostgreSQL only when it
starts it, builds and runs Chat Core, provisions the example, serves the visitor UI and an
admin-route-only dashboard proxy, and prints a scoped in-memory dashboard token. Ctrl+C and
`dev:local:stop` shut down owned processes without removing local database data.

### Release checkpoint

- Contract artifacts have no drift from runtime behavior.
- Clean install, build, test, lint, and type checking pass.
- PostgreSQL migrations work on clean and previous-version databases.
- Mock and Haystack connector contract suites pass.
- Browser reconnect and Cloudflare streaming tests pass.
- Handoff delivery is idempotent and auditable.
- Threat model, retention policy, backup guide, and connector guide are reviewed.

## Work that can run in parallel

After the Phase 1 contract checkpoint:

- Documentation examples can be developed alongside server persistence.
- Browser-client state can use contract fixtures while the server event store is implemented.
- The mock connector can be built alongside persistence after event schemas are fixed.
- Haystack can prepare its event adapter after connector schemas are accepted.

Keep these sequential:

- identity contracts before identity implementation;
- event semantics before SSE and connector runtimes;
- persistence and idempotency before real connector side effects;
- generic contact lifecycle before email delivery;
- admin authorization before the dashboard exposes internal data.

## Plan maintenance

When a task is complete, record the commit or pull request and the verification result under that
task. If a task grows beyond one focused session or about five files, split it before implementation.
If implementation changes an accepted boundary, update the project brief only after owner approval
and add a new ADR.
