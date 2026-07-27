# Admin query API

The read-only `/v1/admin` namespace exposes Chat Core's canonical conversations, messages, retained
event timelines, connector runs, failures, and handoffs. It never reads Haystack storage and never
returns structured contact values.

## Authentication and visibility

Admin routes are disabled unless `ADMIN_TOKEN_SECRET` is configured with at least 32 bytes.
`ADMIN_TOKEN_TTL_SECONDS` defaults to 3600 and accepts 60 through 86400 seconds. The admin secret,
JWT audience (`formation-chat-core-admin`), and claims are separate from visitor session tokens.
Visitor bearer tokens therefore cannot authenticate to this namespace.

The dashboard signs operators in through Formation SSO. `GET /auth/login` redirects to the
registered SSO app, `GET /auth/callback` exchanges the one-time login token, `GET /auth/session`
reports the current dashboard session, and `POST /auth/logout` clears it. The resulting admin JWT
is stored only in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie. The callback accepts only the
configured app ID and callback URL, and only emails in `ADMIN_ALLOWED_EMAILS`.

Trusted tooling may still issue claims matching the published `admin/token-claims` schema:

- `adminId`: operator or service identity;
- `tenantId`: the only tenant the token may query;
- `scopes`: `admin:read`, `admin:internal`, or both;
- `issuedAt` and `expiresAt`: bounded token lifetime.

`admin:read` includes public and operator events. `admin:internal` additionally includes internal
events. Tenant filtering is applied inside every database query. Admins automatically see every
site in that tenant, including sites added after the session was issued. A resource outside the
tenant returns `404` so the endpoint does not disclose its existence.

## Endpoints and filters

- `GET /v1/admin/conversations`
- `GET /v1/admin/conversations/{conversationId}`
- `GET /v1/admin/conversations/{conversationId}/messages`
- `GET /v1/admin/conversations/{conversationId}/events`
- `GET /v1/admin/overview`
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

`GET /v1/admin/overview` returns the token's tenant, all site/domain cards in that tenant, aggregate
counts, and each site's most recent activity timestamp.

## Operations dashboard

The reference dashboard in `apps/dashboard` consumes only these endpoints. Its home page shows the
token's tenant overview, and selecting a domain applies that site's `siteId` to conversations,
runs, failures, and handoffs. It does not read Haystack storage or configure agents. For
production, serve its static build behind the same trusted admin origin as the API (or a narrowly
configured reverse proxy) so browsers do not need broad cross-origin access.

Operators use the Formation SSO button. Browser JavaScript never reads or stores the admin token;
signing out clears the HTTP-only cookie. Theme preference is the only value stored in local storage.
See `apps/dashboard/README.md` for local commands and deployment guidance.
