# Security, privacy, and retention

## HTTP boundary

The server generates correlation IDs, caps JSON bodies, applies request timeouts, and rate-limits
bootstrap, public, and admin traffic separately. `TRUST_PROXY=false` is the safe default. Enable it
only when the server is directly behind a trusted proxy that overwrites forwarding headers.

| Variable                   | Default |      Allowed |
| -------------------------- | ------: | -----------: |
| `HTTP_BODY_LIMIT_BYTES`    |  262144 | 1024–1048576 |
| `REQUEST_TIMEOUT_MS`       |  120000 |  1000–300000 |
| `RATE_LIMIT_WINDOW_MS`     |   60000 | 1000–3600000 |
| `BOOTSTRAP_RATE_LIMIT_MAX` |      30 |     1–100000 |
| `PUBLIC_RATE_LIMIT_MAX`    |     120 |     1–100000 |
| `ADMIN_RATE_LIMIT_MAX`     |     600 |     1–100000 |

Use an edge or distributed limiter for horizontally scaled deployments. The built-in limiter is a
bounded per-process safety control, not a global quota.

## Data handling

The core stores transcripts as the canonical web-chat record. Submitted email values are private
structured input and never appear in API responses, public events, audit events, or request logs.
The retention worker clears contact values first, then deletes expired anonymous conversations and
their execution records in tenant/site scope.

| Variable                        | Default | Meaning                                                                   |
| ------------------------------- | ------: | ------------------------------------------------------------------------- |
| `CONTACT_VALUE_RETENTION_HOURS` |      24 | Time before submitted contact values are redacted                         |
| `ANONYMOUS_RETENTION_DAYS`      |      30 | Time since last conversation update before anonymous transcript deletion  |
| `AUTHENTICATED_RETENTION_DAYS`  |     365 | Reserved policy for authenticated principals when identity exchange ships |
| `RETENTION_SWEEP_INTERVAL_MS`   | 3600000 | Delay between bounded retention sweeps                                    |

Deletion is irreversible. Legal holds and exports must be completed before reducing retention.
Database backups have their own lifecycle and must expire no later than the documented backup
policy. Audit events contain stable action/outcome/scope identifiers, not request payloads, query
strings, tokens, IP addresses, emails, or private tool data.

## Secret rotation

Set the new signing key as `SESSION_TOKEN_SECRET` or `ADMIN_TOKEN_SECRET` and put at most two still
valid old keys in the corresponding `*_PREVIOUS_SECRETS` JSON array. Restart instances gradually,
wait longer than the maximum token TTL, then remove the old key and restart again. New tokens are
always signed by the current key. Metrics use a separate `METRICS_BEARER_TOKEN` of at least 32
bytes. Never reuse database, session, admin, metrics, connector, or email credentials.

## Threat model checklist

- Browsers are untrusted; tenant, site, agent, and connector bindings come from trusted config.
- Session tokens are short-lived and tenant/site/principal scoped; admin tokens use a separate key.
- Public SSE only emits public events. Operator/internal payloads remain out of public transcripts.
- All retryable writes and external delivery jobs retain durable idempotency identities.
- PostgreSQL, admin APIs, metrics, Haystack, and email delivery stay on private authenticated paths.
- Logs and traces must not capture authorization/cookie headers, request bodies, database URLs, or
  connector payloads. Verify production collector rules as well as application redaction.
