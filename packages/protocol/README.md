# Protocol package

This package is the source of the OpenAPI 3.1 document, JSON Schemas, contract fixtures, and
TypeScript types shared by the server, clients, and connectors. TypeBox definitions produce both
the TypeScript types and committed JSON Schema 2020-12 artifacts.

Start with Tasks 1 through 4 in `docs/IMPLEMENTATION_PLAN.md`. Do not add server or UI dependencies
to this package.

## Compatibility

Schemas require fields needed for safe interpretation. Compatible readers must ignore unknown
object properties so producers can add metadata without a breaking version. Enum values and event
types are open only where their schema uses a string pattern; a consumer that does not understand a
new event type must ignore it and continue advancing its event cursor.

Security-sensitive command, connector-input, and credential-bearing response schemas are closed.
They evolve through explicit versioned fields rather than accepting arbitrary browser or runtime
properties.

Removing fields, changing their meaning, or weakening ordering guarantees requires an explicit
compatibility plan. Run `npm run generate --workspace packages/protocol` after changing a schema.
Tests include a drift check for committed artifacts.

Identity assertions have two validation layers. JSON Schema checks their portable shape; the
receiving trusted boundary must additionally verify signature, issuer, nonce replay, expiry,
audience, tenant, and site. `validateIdentityAssertionContext` implements the dynamic time,
audience, tenant, and site comparisons for TypeScript consumers, but does not replace signature or
nonce validation.

## Public chat model

Messages contain typed parts: text, citation, file reference, safe tool status, and structured
input. There is intentionally no public schema for model reasoning, raw tool arguments, or raw tool
results. Connector output is not a canonical conversation event: it cannot assign event IDs,
sequence numbers, timestamps, or replay-control events. The core validates its context and data,
discards unrecognized fields, and creates the ordered canonical event. Connector execution details
remain in the agent runtime. Canonical event shapes are closed so private data cannot leak into
public delivery.

Before execution, implementations must compare every connector run and event correlation ID with
the trusted active execution. Run history must contain only the selected conversation, end with the
current user message, and attribute that message to the trusted user participant. The exported
TypeScript policy helpers implement these mandatory comparisons; other language implementations
must apply the same rules.

V1 defines `public`, `operator`, and `internal` visibility. A delivery boundary must filter by the
caller's scope; validation alone does not authorize disclosure. The published connector fixture at
`fixtures/connector/message-delta.json` validates directly against
`schemas/chat/connector-event.schema.json` in any JSON Schema 2020-12 implementation.

V1 conversations require exactly one user participant with a principal ID and one agent
participant with an agent reference. Implementations must also enforce that those references match
the conversation's trusted `principalId` and `agentRef`; JSON Schema cannot compare sibling field
values portably.

Participant IDs must be unique within a conversation. User messages must reference the user
participant, assistant messages the agent participant, and system messages a system participant.
Public citation and file URLs are HTTPS only. Renderers must still treat labels, excerpts, file
names, URLs, and all connector-produced strings as untrusted text and must not render them as HTML.

The OpenAPI 3.1.1 entry document is `openapi/openapi.json`. Retryable writes require the
`Idempotency-Key` header, lists use cursor pagination, and every operation uses the common error
envelope.

An idempotency key is scoped to the authenticated tenant/site/principal, HTTP operation, and target
resource. The server retains the key with a canonical request hash for its configured retry window.
Repeating the key with the same payload returns the original result; reusing it with a different
payload returns `409 IDEMPOTENCY_CONFLICT`.
