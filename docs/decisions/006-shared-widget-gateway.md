# ADR-006: Use a shared widget gateway and trusted widget registry

## Status

Accepted

## Date

2026-07-23

## Context

Formation needs chat widgets on multiple public websites. Each website should be able to embed a
widget with a script tag and small configuration object, while operators need one dashboard that
lists deployed widgets, switches between websites, and inspects each site's conversations.

Deploying one Worker per widget is operationally noisy and encourages drift in route filtering,
security headers, streaming behavior, and widget assets. Letting browser configuration choose raw
agent runtime settings would break the trusted site and connector boundary.

## Decision

Use one shared stateless gateway Worker, or one equivalent host gateway deployment, to serve all
public widgets and the operator dashboard assets.

The gateway resolves each request through a trusted widget registry keyed by hostname and public
widget key. A public embed may pass display configuration such as theme, launcher style, widget
version, placement, labels, and a public agent alias. The gateway and chat core resolve that public
input to trusted tenant, site, widget, and `agentRef` bindings before bootstrap or message traffic
reaches the core.

The public browser configuration must never contain raw connector URLs, connector credentials,
Haystack tenant keys, model/provider settings, or unrestricted agent slugs. If a website exposes an
`agent` parameter, it is a stable public alias allowed only for that hostname and widget; unknown or
unauthorized aliases are rejected.

The dashboard is served from the shared deployment under an operator-controlled origin or protected
route. It uses the existing admin API to list authorized websites/widgets, show aggregate activity,
and inspect conversations, messages, runs, failures, and handoffs. Public website origins do not
receive admin routes or admin credentials.

## Alternatives considered

### One Worker per website or widget

This keeps each deployment's bindings simple, but multiplies deployment state, makes updates slower,
and increases the chance that security fixes or widget versions drift across websites.

### Browser-selected raw agent configuration

This makes embeds flexible, but lets page JavaScript influence trusted routing. It would allow
cross-tenant mistakes and could expose private connector details.

### Put all widget configuration in the static website

This reduces backend configuration work, but cannot protect agent wiring, service credentials, or
tenant/site isolation.

## Consequences

- The registry becomes the operator-controlled source for deployed widget metadata and trusted
  agent bindings.
- Widget style/version configuration must be separated from private agent wiring.
- The gateway must route widget assets, public chat API traffic, and protected dashboard assets with
  distinct origin, credential, and route policies.
- Admin overview responses should describe deployed widgets or sites well enough for the dashboard
  website switch and conversation drill-down.
- A one-Worker-per-site deployment remains acceptable only as a temporary pilot or isolation
  exception, not the default architecture.
