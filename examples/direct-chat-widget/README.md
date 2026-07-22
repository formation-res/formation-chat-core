# Direct Cloudflare chat widget

This is the deliberately small alternative to deploying Formation Chat Core. The same code can be
deployed as one independently configured Cloudflare Worker per website and trusted Haystack agent.
There is no database, canonical transcript, dashboard, connector job queue, or cross-device history.

Website and agent values are not stored in this repository. Each Worker owns its configuration in
Cloudflare, while `keep_vars` preserves those dashboard values when shared code is redeployed.

## Try it locally

```sh
npm run build --workspace @formation-chat-core/direct-chat-widget-example
cd examples/direct-chat-widget
cp .dev.vars.example .dev.vars
npx wrangler dev --port 8790
```

Open `http://127.0.0.1:8790`. The example configuration uses mock mode and needs no credentials.

## Deploy one website Worker

Create a Worker in the Formation Cloudflare account and give it a site-specific name, such as
`formation-chat-example`. In **Settings → Variables and Secrets**, add these text variables:

| Variable              | Value                                             |
| --------------------- | ------------------------------------------------- |
| `BACKEND_MODE`        | `haystack`                                        |
| `ALLOWED_ORIGINS`     | JSON string such as `["https://www.example.com"]` |
| `HAYSTACK_BASE_URL`   | Haystack HTTPS origin, without an API path        |
| `HAYSTACK_AGENT_REF`  | Stable public label for this integration          |
| `HAYSTACK_TENANT_KEY` | Trusted Haystack tenant key                       |
| `HAYSTACK_AGENT_SLUG` | Exact configured Haystack agent slug              |

Add `HAYSTACK_CONNECTOR_TOKEN` as a **Secret**, never as plaintext. Configure the desired
`workers.dev` address, route, or custom domain in Cloudflare as part of that Worker.

Build and deploy the shared code to the named Worker:

```sh
npm run build --workspace @formation-chat-core/direct-chat-widget-example
cd examples/direct-chat-widget
npm run deploy:site -- --name formation-chat-example
```

The deployment command keeps all dashboard-managed variables and secrets. Use the same command and
Worker name for later code updates.

To add another website with another agent, create another Worker, configure its own values, and run
the same command with the new Worker name. One Worker may allow several origins only when all of
them should use the same Haystack configuration.

## Embed the configured Worker

```html
<script type="module" src="https://YOUR-WORKER-HOST/widget.js"></script>
<formation-chat-widget
  endpoint="https://YOUR-WORKER-HOST/api/chat"
  title="Ask us"
  welcome="Hi — what would you like to know?"
></formation-chat-widget>
```

The launcher uses the built-in animated agent by default. To use a conventional text button:

```html
<formation-chat-widget launcher-type="button" launcher-text="Ask us"></formation-chat-widget>
```

To replace the built-in agent with a website-specific animated GIF, WebP, or SVG:

```html
<formation-chat-widget launcher-image="/images/website-agent.webp"></formation-chat-widget>
```

The launcher shows a compact artwork card and `Ceci n'est pas une chatbot.` with a respectful René
Magritte attribution on hover or keyboard focus. Set website-specific main copy with
`launcher-tooltip`, or use an empty value to disable the complete tooltip:

```html
<formation-chat-widget launcher-tooltip="Ask MailFront anything"></formation-chat-widget>
```

The popup remains open while the pointer moves from the launcher onto the artwork. Hovering the
popup reveals a transparent top-left enlarge indicator. Click anywhere on the artwork or caption to
smoothly expand or reduce the complete card; the indicator remains keyboard accessible. Leaving the
popup closes it and resets the compact size. Clicking the robot launcher itself still opens the chat
panel.

The image is decorative because the enclosing button always has an accessible `Open chat` label.
Its default size can be adjusted with `--chat-launcher-size` on the custom element.

The Worker accepts only `POST /api/chat`, constrains browser input, fixes the tenant and agent from
its own trusted bindings, and returns Haystack's SSE body without buffering.

`widget.js` is intentionally public and cross-origin loadable. The `/api/chat` endpoint remains
restricted to `ALLOWED_ORIGINS`. The widget stores only its opaque visitor ID, conversation ID, and
latest 30 messages in that website's local storage. It never receives the Haystack token, tenant
key, agent slug, or raw private tool output.

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
