# Operations dashboard

This is the read-only React operations UI for Formation Chat Core. It queries `/v1/admin` for
canonical conversations, ordered messages and events, agent runs, stable failure codes, and email
handoff state. It neither configures Haystack nor reads an agent runtime database.

## Run locally

The easiest path from the repository root starts the entire local stack:

```sh
npm ci
npm run dev:local
```

Open `http://127.0.0.1:4174`. The local stack provides a development admin session and proxies the
dashboard API. See the
[Local Chat guide](../../examples/local-chat/README.md) for start, stop, and Haystack commands.

Useful commands:

```sh
npm test --workspace @formation-chat-core/dashboard
npm run typecheck --workspace @formation-chat-core/dashboard
npm run lint --workspace @formation-chat-core/dashboard
npm run build --workspace @formation-chat-core/dashboard
npm run test:browser --workspace @formation-chat-core/dashboard
```

The production build is written to `apps/dashboard/dist`.

## Authentication and deployment

Production authentication uses Formation SSO through the same origin that serves the dashboard.
The gateway proxies `/auth/*` and `/v1/admin/*` to Chat Core while preserving `Cookie`,
`Set-Cookie`, `Location`, and redirect responses. Browser JavaScript never receives the admin JWT.
Configure the server with `ADMIN_TENANT_ID`, `ADMIN_SSO_BASE_URL`, `ADMIN_SSO_UI_URL`,
`ADMIN_SSO_APP_ID`, `ADMIN_PUBLIC_BASE_URL`, and `ADMIN_ALLOWED_EMAILS`.

For production, serve the static build behind the same protected admin origin as Chat Core and
reverse-proxy `/v1/admin/*` to the service. If separate origins are unavoidable, allow only the
specific dashboard origin at the trusted gateway. Do not use wildcard credentialed CORS and do
not embed an admin token into the JavaScript build.

## Interaction model

- Conversations use a desktop list/detail layout and a mobile drill-in flow.
- Transcript and event tabs distinguish public, operator, and internal visibility.
- Runs, failures, and handoffs use keyboard-accessible expandable rows.
- Correlation controls connect canonical IDs; the run ID is also sent to connectors for
  cross-system tracing. A missing connector-specific trace ID is shown as unavailable.
- Lists request at most 100 records. Long transcripts continue through the returned cursor.
- Initial loads use skeletons; refreshes keep existing content mounted to avoid flicker.
- Light/dark themes, reduced motion, empty/error states, disabled controls, and WCAG AA contrast
  are built in.
