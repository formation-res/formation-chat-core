# Observability and release checklist

Set a unique `METRICS_BEARER_TOKEN` to enable `/metrics`; without it the route does not exist. The
Prometheus text endpoint exposes only method and status-class labels to avoid tenant IDs, resource
IDs, routes, or PII becoming telemetry. Scrape it over a private network. Alert on readiness
failure, 5xx rate, connector failures/retries, retention-worker failure, database capacity, queue
age, and handoffs stuck in delivering state. Application logs use correlation IDs and redact auth
and cookie headers.

## Release

1. Review the diff, accepted ADRs, generated contract drift, migration order, and rollback notes.
2. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
3. Run `npm audit --omit=dev --audit-level=high` and a repository secret scanner such as Gitleaks.
4. Run PostgreSQL integration tests on a clean database and one upgraded from the prior release.
5. Run the mock, Haystack contract, browser reconnect, Cloudflare runtime, dashboard, and handoff
   delivery suites. Restart a worker mid-job and confirm stable IDs prevent duplicate side effects.
6. Complete the backup/restore drill and record the date, backup identifier, RPO, and restore time.
7. Build the production image, inspect its package inventory, and smoke-test `/health/ready` plus an
   isolated test-site conversation without real customer data.
8. Deploy canary instances, monitor the signals above, then roll out gradually. Roll back the app
   image if needed; do not reverse a data migration unless its documented `down` path was rehearsed.

Release evidence must contain no credentials, visitor contact data, transcript text, or private
tool payloads.
