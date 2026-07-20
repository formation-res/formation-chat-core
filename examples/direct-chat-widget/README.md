# Direct Cloudflare chat widget

This is the deliberately small alternative to deploying Formation Chat Core. One Cloudflare
Worker serves an embeddable Web Component and streams requests directly to one trusted Haystack
agent. There is no database, canonical transcript, dashboard, connector job queue, or cross-device
history.

## Try it locally

```sh
npm run build --workspace @formation-chat-core/direct-chat-widget-example
cd examples/direct-chat-widget
npx wrangler dev --port 8790
```

Open `http://127.0.0.1:8790`. The default `BACKEND_MODE=mock` needs no credentials.

Embed the built component on another page with:

```html
<script type="module" src="https://YOUR-WIDGET-HOST/widget.js"></script>
<formation-chat-widget
  endpoint="https://YOUR-WIDGET-HOST/api/chat"
  title="Ask us"
  welcome="Hi — what would you like to know?"
></formation-chat-widget>
```

Add the website's exact HTTPS origin to `ALLOWED_ORIGINS`. The widget stores only its opaque visitor
ID, conversation ID, and latest 30 messages in that website's local storage. It never receives the
Haystack token, tenant key, agent slug, or raw private tool output.

`widget.js` is intentionally public and cross-origin loadable. The `/api/chat` endpoint remains
restricted to the exact origins configured in `ALLOWED_ORIGINS`.

## Deploy a mock preview

```sh
npm run build --workspace @formation-chat-core/direct-chat-widget-example
npx wrangler deploy --cwd examples/direct-chat-widget
```

The root configuration deploys to `workers.dev` in deterministic mock mode. It is safe for UI
testing but is not connected to an agent.

## Connect production to Haystack

Edit the `env.production.vars` values in `wrangler.jsonc`:

- `ALLOWED_ORIGINS`: exact website HTTPS origins;
- `HAYSTACK_BASE_URL`: the protected Haystack HTTPS origin;
- `HAYSTACK_AGENT_REF`: public opaque agent label;
- `HAYSTACK_TENANT_KEY`: trusted Haystack tenant key;
- `HAYSTACK_AGENT_SLUG`: trusted configured agent slug.

Set the same bearer token configured as Haystack's `connector_api_token`; enter it interactively and
do not paste it into Git or shell history:

```sh
cd examples/direct-chat-widget
npx wrangler secret put HAYSTACK_CONNECTOR_TOKEN --env production
npx wrangler deploy --env production
```

Before production, add the desired route or custom domain to `env.production`, keep Haystack behind
HTTPS, and run the tests below. The Worker accepts only `POST /api/chat`, constrains browser input,
fixes agent configuration server-side, and returns Haystack's SSE body without buffering.

## Verify

```sh
npm test --workspace @formation-chat-core/direct-chat-widget-example
npm run typecheck --workspace @formation-chat-core/direct-chat-widget-example
npm run lint --workspace @formation-chat-core/direct-chat-widget-example
npx wrangler deploy --dry-run --cwd examples/direct-chat-widget
```

With `wrangler dev --port 8790` running:

```sh
npm run test:browser --workspace @formation-chat-core/direct-chat-widget-example
```

The browser smoke checks the complete mock conversation, axe accessibility, refresh persistence,
and the 320-pixel layout.
