# Protocol package

This package is the source of the OpenAPI 3.1 document, JSON Schemas, contract fixtures, and
TypeScript types shared by the server, clients, and connectors. TypeBox definitions produce both
the TypeScript types and committed JSON Schema 2020-12 artifacts.

Start with Tasks 1 through 4 in `docs/IMPLEMENTATION_PLAN.md`. Do not add server or UI dependencies
to this package.

## Compatibility

Schemas require fields needed for safe interpretation. Compatible readers must ignore unknown
object properties so producers can add metadata without a breaking version. Enum values and event
types are open only where their schema uses a string pattern; a consumer that does not understand a
new event type must ignore it and continue advancing its event cursor.

Removing fields, changing their meaning, or weakening ordering guarantees requires an explicit
compatibility plan. Run `npm run generate --workspace packages/protocol` after changing a schema.
Tests include a drift check for committed artifacts.

Identity assertions have two validation layers. JSON Schema checks their portable shape; the
receiving trusted boundary must additionally verify signature, issuer, nonce replay, expiry,
audience, tenant, and site. `validateIdentityAssertionContext` implements the dynamic time,
audience, tenant, and site comparisons for TypeScript consumers, but does not replace signature or
nonce validation.
