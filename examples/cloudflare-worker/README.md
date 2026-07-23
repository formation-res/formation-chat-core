# Cloudflare Worker gateway example

This example deploys the React reference UI, the read-only operations dashboard, an embeddable
widget script, and a stateless shared gateway in one Cloudflare Worker. Static assets are served
directly by Cloudflare; `/widget.js`, `/widget/config`, and allowed `/v1/*` requests enter the
Worker code.

## Security boundary

The gateway:

- resolves the integration site from the request hostname and injects its trusted `siteKey` plus
  optional public widget alias into session bootstrap requests;
- serves `/widget.js` and public `/widget/config` responses for configured widget keys;
- validates public widget `agent` aliases for the hostname and widget before bootstrap reaches the
  core;
- requires an exact configured `Origin`, or same-origin Fetch Metadata when a browser GET omits it,
  and returns the trusted origin rather than `*` in CORS responses;
- rejects identity-exchange paths and methods outside the public route allowlist;
- allows read-only `/v1/admin/*` dashboard API requests only from configured dashboard origins;
- reconstructs upstream headers from an allowlist, dropping forwarding, tenant, site, connector,
  agent, and caller-supplied service-credential headers;
- accepts only JSON writes and reads at most 128 KiB before forwarding them;
- forwards the short-lived browser bearer token only after bootstrap;
- injects `X-Formation-Chat-Service-Token` from a required Worker secret; and
- returns the upstream `ReadableStream` directly, preserving incremental SSE delivery.

The service token is an origin credential, not a browser session token. Configure the private
network ingress or reverse proxy in front of chat core to verify and remove
`X-Formation-Chat-Service-Token` before requests reach application logs. Do not expose an origin
that ignores this credential. A private service binding, mTLS, or another authenticated ingress
can replace this header without changing the browser protocol.

## Configure

Edit non-secret values in `wrangler.jsonc`:

- `CHAT_CORE_BASE_URL` must be an HTTPS origin without a path.
- `CHAT_SITES` is a JSON object keyed by lowercase public hostname. Each entry contains a trusted
  `siteKey`, one or more exact HTTPS `allowedOrigins`, optional exact HTTPS `dashboardOrigins`, and
  optional widget configuration.
- `widget.agentAliases` maps public aliases such as `support` to labels for this site. Browser
  embeds may pass an alias; Chat Core validates it against the widget registry and resolves the
  trusted `agentRef`. Browser embeds never pass raw connector URLs, Haystack tenant keys,
  unrestricted agent slugs, or credentials.

Declare the production credential interactively; never put its value in the config or shell
history:

```sh
cd examples/cloudflare-worker
npx wrangler secret put CHAT_CORE_SERVICE_TOKEN
```

For local development, put the same key in an untracked `.dev.vars` file. Wrangler validates the
required secret name declared by `secrets.required` and generates its TypeScript binding.

## Build and verify

From the repository root:

```sh
npm run build --workspace @formation-chat-core/cloudflare-worker-example
npm test --workspace @formation-chat-core/cloudflare-worker-example
npm run test:browser --workspace @formation-chat-core/cloudflare-worker-example
npm run test:runtime --workspace @formation-chat-core/cloudflare-worker-example
npm run typecheck --workspace @formation-chat-core/cloudflare-worker-example
npx wrangler deploy --dry-run --cwd examples/cloudflare-worker
```

The runtime test uses Cloudflare's local workerd integration. The static build bundles the browser
client and React UI into `dist/site`; the checked-in `_headers` file applies CSP, clickjacking,
content-sniffing, referrer, feature, and transport protections to Cloudflare's static responses.

Deploy after configuring the production hostname, core URL, site map, route, and secret:

```sh
cd examples/cloudflare-worker
npx wrangler deploy
```

## Direct versus gateway integration

Direct browser-to-core integration remains useful for private development: configure the core's
allowed origin and point `createHttpChatTransport()` at the core URL. Public websites should use
this gateway so the browser sees only a same-origin endpoint, cannot select a different site or
agent binding, and never receives the long-lived origin credential.

The public gateway intentionally does not expose `/v1/identity/exchange`. Authenticated host-user
exchange belongs behind a separately authenticated host backend boundary.
