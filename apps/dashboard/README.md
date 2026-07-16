# Operations dashboard

This is the read-only React operations UI for Formation Chat Core. It queries `/v1/admin` for
canonical conversations, ordered messages and events, agent runs, stable failure codes, and email
handoff state. It neither configures Haystack nor reads an agent runtime database.

## Run locally

From the repository root:

```sh
npm install
npm run dev --workspace @formation-chat-core/dashboard
```

Open `http://127.0.0.1:4174`, then enter the Chat Core base URL and a short-lived admin JWT. The
development server serves dashboard assets only; the API must be reachable by the browser.

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

The dashboard deliberately has no login service and does not mint admin credentials. A trusted
deployment component must issue the separately signed JWT described in
[`docs/api/admin-queries.md`](../../docs/api/admin-queries.md). The token is held in React memory;
it is not written to local storage, session storage, URLs, or logs. Disconnecting or closing the
tab clears it.

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
