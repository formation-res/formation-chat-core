# Formation Chat Core project brief

## Status

Confirmed on 2026-07-15. This document is the source for product intent and v1 scope. Change it
only when the project owner confirms a change in intent.

## Outcome

Build a self-hosted, open-source, headless chat service with stable APIs, tidy schemas, durable
sessions, message streaming, synchronization, agent connectors, and detailed integration
documentation. Applications can use the reference UI, replace it, or build directly on the
browser client and protocol. Public websites can embed one configured chat widget with a script tag
and small public configuration object, while the service keeps the trusted widget, site, and agent
wiring server side.

The core must not depend on one UI framework, deployment platform, or agent runtime. Haystack is
the first connector, not part of the generic domain model.

## Users

The first real users are anonymous visitors on public websites. The same service must also support
users authenticated by a host application.

### Anonymous visitors

- History persists in the same browser.
- Anonymous cross-device recovery is out of scope for v1.
- A host-domain cookie or equivalent opaque identifier resumes the visitor session.
- A visitor may have more than one conversation.

### Authenticated users

- The host application asserts its stable user identifier through a trusted server boundary.
- Conversation history can follow that identity across browsers and devices.
- Browser input alone must never be accepted as proof of an authenticated identity.

## Product boundaries

### Chat core owns

- tenants and integration sites;
- widget registrations and trusted site/widget-to-agent bindings;
- public widget configuration served to browser embeds;
- anonymous and externally authenticated principals;
- browser sessions and access tokens;
- conversations, participants, messages, and content parts;
- message ordering, idempotency, retry state, and final status;
- the ordered public event stream and reconnect behavior;
- structured input requests, including contact details;
- generic handoff state;
- connector run records and correlation identifiers;
- admin read APIs for conversations, runs, failures, and handoffs.

### Agent runtime owns

- agent definitions, prompts, instructions, and response behavior;
- knowledge bases, retrieval, tools, and tool permissions;
- model execution and provider credentials;
- the decision to request a handoff;
- handoff target configuration;
- handoff summary generation;
- delivery-specific behavior such as sending handoff email;
- private execution traces, raw tool inputs, and raw tool results.

### UI owns

- transcript and composer presentation;
- loading, streaming, retry, and reconnect states;
- rendering typed public content parts;
- structured inputs requested by the agent;
- accessibility and integration-specific appearance.
- public style options passed by the host page, after applying the trusted widget configuration.

The browser client owns protocol state, cursor handling, deduplication, and synchronization. UI
packages should remain thin consumers of the browser client.

## Deployment model

Self-hosting is the only required deployment model for v1. The first deployment will run the chat
core on the same server as the Haystack agents, typically with Docker Compose and a private network
between the services.

A public website may be hosted on Cloudflare Pages or another static host. A shared Cloudflare
Worker, or equivalent host gateway, is the recommended website-facing gateway:

```text
browser widget
  -> shared Cloudflare Worker or host backend
  -> Formation Chat Core
  -> Haystack connector
  -> Haystack agent
```

The Worker is stateless. It can serve the embeddable widget script, widget assets, public widget
configuration, public chat routes, and protected dashboard assets for many websites at once. It
identifies the site and widget from trusted hostname and widget-key configuration, exchanges host
identity, applies edge controls, keeps service credentials out of browser code, and passes response
streams through unchanged. It does not store chats or run agents. Cloudflare Durable Objects are not
required while the chat core is the canonical state owner.

One Worker per website or widget is not the default. It is acceptable only for temporary pilots,
hard isolation requirements, or operational exceptions. The scalable model is one shared gateway
deployment with an operator-controlled widget registry.

Direct browser-to-core integration may be documented as a simpler option. Production public sites
should prefer a gateway because it provides same-origin requests, secret isolation, origin checks,
and a place for rate limits.

## V1 conversation model

V1 supports one user and one selected agent per conversation. The schema must allow future
participant kinds such as `human_operator`, `system`, and additional agents, but v1 does not ship a
live operator inbox or multi-agent orchestration.

Suggested resource hierarchy:

```text
Tenant
  Site
    Widget
      Agent binding
    Principal
      Browser session
      Conversation
        Participants
        Messages
          Content parts
        Ordered events
        Agent runs
        Structured input requests
        Handoffs
```

Messages should contain a discriminated list of parts rather than one text field. Initial public
parts may include text, citation, file reference, tool status, and structured input. Reasoning,
secrets, and unrestricted tool payloads are never public parts.

## Sessions and authentication

The core needs two trusted entry paths:

1. Anonymous bootstrap for a configured site.
2. Authenticated identity exchange initiated by a host backend or trusted gateway.

The bootstrap result should use a short-lived token scoped to one tenant, site, principal, and set
of allowed operations. Long-lived service credentials stay in the Worker or host backend.

Site and tenant isolation must be enforced in storage queries as well as request authorization.
Browser-controlled fields such as tenant ID, site ID, principal ID, connector name, and agent
reference must not override trusted configuration.

## Message delivery and synchronization

Use ordinary HTTP commands for user writes and Server-Sent Events for live output in v1.

- Every accepted command has an idempotency key.
- Every conversation event has a monotonically increasing sequence number.
- The client reconnects with its last event ID.
- The server replays retained events after that cursor.
- If replay is no longer possible, the server emits `sync.required`.
- The client then fetches the canonical conversation snapshot.
- Final message state is always available through normal query endpoints.

WebSockets may be added later as another transport. They must preserve the same event semantics and
must not create a separate chat model.

## Connector model

The connector boundary must work both in process and across a network. A TypeScript connector SDK
provides the reference interface. A language-neutral HTTP and event contract allows Python and
other runtimes to implement the same behavior.

A run request contains opaque correlation IDs, the selected agent reference, the current user
message, normalized public history, principal context, and trusted integration metadata. A
connector streams generic events back to the core.

Initial event types:

```text
run.started
message.started
message.delta
message.completed
tool.started
tool.completed
tool.failed
citation.added
contact.requested
handoff.requested
handoff.completed
run.completed
run.failed
sync.required
```

Every event declares one visibility level:

- `public`: safe for the visitor and transcript UI;
- `operator`: visible to authorized staff;
- `internal`: restricted to diagnostics and connector processing.

The core validates connector events at the boundary. Unknown additive fields may be retained for
forward compatibility, but invalid event shapes must not enter the canonical event stream.

## Haystack integration

The current Formation Haystack service accepts a synchronous request with channel, tenant, agent,
user, thread, text, response mode, and metadata. It also loads and stores its own conversation
history.

Use two migration steps:

### Compatibility connector

Map the generic IDs onto the existing request:

```text
tenant_key <- trusted connector configuration
agent_slug <- trusted widget agent binding
user_id    <- chat principal ID
thread_id  <- chat conversation ID
text       <- submitted user message
metadata   <- run ID, message ID, origin, and correlation data
```

This allows an early end-to-end slice, but temporarily duplicates history in the chat core and
Haystack.

### Native connector endpoint

Add a stateless streaming endpoint to Haystack. The chat core supplies normalized conversation
history. Haystack stores agent runs and private execution traces, not a competing web transcript.
Existing mail and Zulip storage may remain channel-specific because those channels have their own
delivery and threading requirements.

## Tools and citations

Haystack decides which tools exist and when to use them. The connector translates selected tool
progress into generic public status events. Raw tool arguments and results default to internal.

Citations are typed content parts or events. They should use stable source identifiers and safe
display metadata. The core and UI must treat all connector output as untrusted input.

## Human handoff

The required v1 handoff flow is email based:

1. Haystack decides that a human is required.
2. If the anonymous visitor has no verified email, the connector emits `contact.requested` with an
   email schema.
3. The UI renders an email field. A text-only UI may ask conversationally.
4. The core validates and records the address and the visitor's consent.
5. The Haystack run resumes with the structured contact value.
6. Haystack creates a short handoff call and a sensible summary of the conversation.
7. The configured mail tool sends the handoff to the trusted target and CCs the visitor.
8. Delivery result and handoff state return as generic events.

Do not rely only on extracting an email address from free-form message text. Do not accept the
handoff target from the browser or model output. Delivery must be idempotent, sanitize headers, and
record failures without leaking provider details to the visitor.

## Dashboard

The chat dashboard is a separate UI over the chat-core admin API. It should show:

- conversation transcript and status;
- message and event ordering;
- agent run timeline and correlation IDs;
- public tool status and private diagnostic metadata according to authorization;
- connector failures and retry state;
- pending, completed, and failed handoffs;
- connector health and basic usage data.

The existing Haystack dashboard remains responsible for configuring agents, prompts, tools, KBs,
and handoff targets. The two dashboards may link to each other through stable IDs. They should not
read each other's database directly.

## API direction

The first public API should cover:

```text
POST /v1/sessions
POST /v1/identity/exchange

GET  /v1/conversations
POST /v1/conversations
GET  /v1/conversations/{conversationId}

GET  /v1/conversations/{conversationId}/messages
POST /v1/conversations/{conversationId}/messages
GET  /v1/conversations/{conversationId}/events

POST /v1/conversations/{conversationId}/inputs/{requestId}
POST /v1/conversations/{conversationId}/cancel
POST /v1/conversations/{conversationId}/retry
```

Admin APIs use a separate scope and namespace. List endpoints use cursor pagination. Errors use one
stable envelope with a machine-readable code, safe message, correlation ID, and optional field
details.

Exact resources and paths remain proposed until Task 1 completes the protocol review.

## Technology direction

- TypeScript and Node.js for the reference server and SDKs.
- PostgreSQL for production storage.
- A simple local development database mode may be added if it does not change semantics.
- OpenAPI 3.1 and JSON Schema for public contracts.
- A framework-neutral browser client.
- Optional React and Web Component UIs.
- A Python-compatible network connector contract for Haystack.

The project should select the concrete server framework, database library, migration tool, test
runner, and schema tool during the first implementation phase. Each expensive-to-reverse choice
requires an ADR.

## V1 success criteria

- A static website can start or resume an anonymous same-browser conversation.
- An authenticated app can exchange a trusted host identity.
- A user message produces a durable, streamed agent response.
- A disconnected browser resumes without losing the final response.
- Retried writes do not duplicate messages or handoff email.
- The same UI and client work with the mock and Haystack connectors.
- Tool status and citations can be displayed without exposing private payloads.
- The email handoff flow works from contact request through tracked delivery.
- The dashboard can inspect conversations, runs, failures, and handoffs through admin APIs.
- A new contributor can implement another connector using only repository documentation.

## Explicitly out of scope for v1

- a hosted multi-tenant product operated by Formation;
- live human participation in the chat transcript;
- a full operator inbox;
- multiple agents participating in one conversation;
- agent orchestration inside the chat core;
- anonymous cross-device recovery;
- WebSockets as the only transport;
- UI-specific state in the server domain model;
- Haystack-specific fields in public chat resources;
- arbitrary raw model reasoning or tool payloads in public events.

## Main risks

### Duplicate conversation ownership

The compatibility connector can leave the chat core and Haystack with similar transcripts. Treat
this as migration scaffolding and move web-chat history ownership to the core before broader use.

### Event compatibility

Clients will depend on observable ordering and reconnect behavior. Specify event envelopes,
visibility, sequence rules, cancellation, and failure semantics before implementation.

### Identity mistakes

Anonymous and authenticated users share much of the model but have different trust boundaries.
Keep identity exchange server side and test tenant, site, and principal isolation adversarially.

### Public tool leakage

Connector responses are untrusted. Visibility must default to internal, with explicit projection to
safe public status.

### Handoff side effects

Email delivery can duplicate under retries. Use an idempotent delivery key tied to the handoff and
record provider results separately from public messages.
