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
