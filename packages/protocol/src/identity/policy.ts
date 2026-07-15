import type { IdentityAssertion } from './schemas.js';

export interface IdentityAssertionContext {
  audience: string;
  tenantId: string;
  siteId: string;
  now: Date;
}

/** Applies trust-context checks that JSON Schema cannot express dynamically. */
export function validateIdentityAssertionContext(
  claims: IdentityAssertion,
  context: IdentityAssertionContext,
): boolean {
  const expiresAt = Date.parse(claims.expiresAt);
  const issuedAt = Date.parse(claims.issuedAt);
  const now = context.now.getTime();

  return (
    Number.isFinite(expiresAt) &&
    Number.isFinite(issuedAt) &&
    issuedAt <= now &&
    expiresAt > now &&
    claims.audience === context.audience &&
    claims.tenantId === context.tenantId &&
    claims.siteId === context.siteId
  );
}
