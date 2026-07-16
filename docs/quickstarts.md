# Deployment quick starts

## Local mock

Run `docker compose up --build`, then provision a tenant/site with an allowed local origin. Compose
starts PostgreSQL, the core, durable mock connector execution, retention, audit storage, and the
separately authenticated admin surface. Replace every example secret outside local development.

## Direct website

Serve the Web Component or React package from the website, configure that exact HTTPS origin on its
site record, and point the browser transport at the core HTTPS origin. Keep `TRUST_PROXY=false`
unless a trusted ingress overwrites forwarding headers. Direct mode is best for private or tightly
controlled sites; public sites should use the gateway below.

## Cloudflare website gateway

Follow [the Worker guide](../examples/cloudflare-worker/README.md). Map hostname to site key in
trusted Worker configuration, store the origin credential as a Worker secret, allow only public
chat routes, and keep the core origin private or protected by authenticated ingress.

## Authenticated application

The v1 core currently implements anonymous browser sessions. Put chat behind the host application's
authenticated backend and map the signed-in user to a stable, non-email identifier; do not place
identity claims in browser-controlled bootstrap data. The public Cloudflare example intentionally
does not expose identity exchange. Enable native authenticated-principal retention only when that
contract is implemented.

## Haystack

Set `CONNECTOR_MODE=haystack` and configure the trusted agent map described in
[Haystack compatibility](connectors/haystack-compatibility.md). Keep Haystack on a private network,
use HTTPS across untrusted links, run the live contract suite against the matching
`haystack-mailagent` checkout, and monitor duplicate-history behavior until the compatibility path
is retired.
