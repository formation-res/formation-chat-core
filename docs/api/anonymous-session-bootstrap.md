# Anonymous session bootstrap

`POST /v1/sessions` creates or resumes an anonymous browser session for a configured site. It does
not create a conversation.

## Request

Send both headers:

- `Origin`: the browser origin. The server must find an exact origin match in the site's
  `allowedOrigins` list after URL normalization.
- `Idempotency-Key`: 1 to 255 visible ASCII characters. A retry with the same key and request
  resumes the same browser identity, principal, and session. Reusing the key with a different body
  returns `409 IDEMPOTENCY_KEY_REUSED`.

The JSON body contains `siteKey` and may contain `browserIdentity`. The site key selects trusted
tenant, site, and agent configuration. The client cannot override those fields. On the first
request, omit `browserIdentity`; the server returns a generated value. Store that value as a
browser credential and send it on later bootstrap requests.

## Response

A successful response contains the browser identity, anonymous principal, browser session, and a
short-lived bearer token. The token is scoped to the resolved tenant, site, principal, session, and
public chat operations. The server rejects expired, modified, or cross-site tokens.

The server returns `404 SITE_NOT_FOUND` for an unknown site and `403 ORIGIN_NOT_ALLOWED` for a
disallowed origin. Invalid bodies or missing required headers return `400`.

## Server configuration

`SESSION_TOKEN_SECRET` is required and must contain at least 32 bytes. Set
`SESSION_TOKEN_TTL_SECONDS` between 60 and 3600; the default is 900 seconds. Startup errors name
invalid configuration keys without printing their values.
