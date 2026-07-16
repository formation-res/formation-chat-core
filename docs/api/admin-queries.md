# Admin query API

The read-only `/v1/admin` namespace exposes Chat Core's canonical conversations, messages, retained
event timelines, connector runs, failures, and handoffs. It never reads Haystack storage and never
returns structured contact values.

## Authentication and visibility

Admin routes are disabled unless `ADMIN_TOKEN_SECRET` is configured with at least 32 bytes.
`ADMIN_TOKEN_TTL_SECONDS` defaults to 3600 and accepts 60 through 86400 seconds. The admin secret,
JWT audience (`formation-chat-core-admin`), and claims are separate from visitor session tokens.
Visitor bearer tokens therefore cannot authenticate to this namespace.

A trusted deployment component issues claims matching the published `admin/token-claims` schema:

- `adminId`: operator or service identity;
- `tenantId`: the only tenant the token may query;
- `siteIds`: the explicit non-empty set of sites the token may query;
- `scopes`: `admin:read`, `admin:internal`, or both;
- `issuedAt` and `expiresAt`: bounded token lifetime.

`admin:read` includes public and operator events. `admin:internal` additionally includes internal
events. Tenant and site restrictions are applied inside every database query. A requested `siteId`
outside the token's set returns `403 FORBIDDEN_SITE`; a resource outside the set returns `404` so
the endpoint does not disclose its existence. Tenant filtering is mandatory and implicit in the
token rather than caller-selectable.

## Endpoints and filters

- `GET /v1/admin/conversations`
- `GET /v1/admin/conversations/{conversationId}`
- `GET /v1/admin/conversations/{conversationId}/messages`
- `GET /v1/admin/conversations/{conversationId}/events`
- `GET /v1/admin/runs`
- `GET /v1/admin/failures`
- `GET /v1/admin/handoffs`

Every list accepts `cursor` and `limit` (default 20, maximum 100). Cursors are resource-specific;
using a conversation cursor for runs, for example, returns `400 INVALID_CURSOR`. Conversation,
run, failure, and handoff lists order by creation time and opaque ID descending. Messages and
events order by their canonical sequence ascending.

Top-level lists accept the relevant subset of `siteId`, `agentRef`, `status`, `createdAfter`, and
`createdBefore`. Date windows are half-open: `createdAfter` is inclusive and `createdBefore` is
exclusive. `createdAfter` must be earlier than `createdBefore`.

Failure records contain only stable `errorCode` values. Handoff records contain lifecycle status
and correlation IDs, not the submitted email address or provider response.

## Operations dashboard

The reference dashboard in `apps/dashboard` consumes only these endpoints. It does not read
Haystack storage or configure agents. For production, serve its static build behind the same
trusted admin origin as the API (or a narrowly configured reverse proxy) so browsers do not need
broad cross-origin access.

Operators enter a short-lived admin JWT when connecting. The dashboard keeps the token in memory,
never local storage, and clears it on disconnect or tab close. Theme preference is the only value
stored in local storage. See `apps/dashboard/README.md` for local commands and deployment guidance.
