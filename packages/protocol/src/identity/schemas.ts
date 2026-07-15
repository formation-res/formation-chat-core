import { type Static, Type } from '@sinclair/typebox';

import { OpaqueIdSchema, TimestampSchema } from '../common/index.js';

export const TenantSchema = Type.Object(
  {
    tenantId: OpaqueIdSchema,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    createdAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type Tenant = Static<typeof TenantSchema>;

export const SiteSchema = Type.Object(
  {
    siteId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    allowedOrigins: Type.Array(Type.String({ format: 'uri' }), { maxItems: 100 }),
    agentRef: OpaqueIdSchema,
    createdAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type Site = Static<typeof SiteSchema>;

const AnonymousPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('anonymous'),
    principalId: OpaqueIdSchema,
  },
  { additionalProperties: false },
);

const ExternalPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('external'),
    principalId: OpaqueIdSchema,
    issuer: Type.String({ minLength: 1, maxLength: 512 }),
    subject: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
);

export const PrincipalSchema = Type.Union([AnonymousPrincipalSchema, ExternalPrincipalSchema]);
export type Principal = Static<typeof PrincipalSchema>;

export const BrowserSessionSchema = Type.Object(
  {
    sessionId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    principalId: OpaqueIdSchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type BrowserSession = Static<typeof BrowserSessionSchema>;

export const IdentityAssertionSchema = Type.Object(
  {
    issuer: Type.String({ minLength: 1, maxLength: 512 }),
    audience: Type.String({ minLength: 1, maxLength: 512 }),
    subject: Type.String({ minLength: 1, maxLength: 512 }),
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    nonce: OpaqueIdSchema,
  },
  { additionalProperties: false },
);
export type IdentityAssertion = Static<typeof IdentityAssertionSchema>;

export const AccessScopeSchema = Type.Union([
  Type.Literal('conversations:read'),
  Type.Literal('conversations:write'),
  Type.Literal('events:read'),
  Type.Literal('inputs:write'),
]);
export type AccessScope = Static<typeof AccessScopeSchema>;

export const SessionTokenClaimsSchema = Type.Object(
  {
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    principalId: OpaqueIdSchema,
    sessionId: OpaqueIdSchema,
    scopes: Type.Array(AccessScopeSchema, { minItems: 1, uniqueItems: true }),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type SessionTokenClaims = Static<typeof SessionTokenClaimsSchema>;

export const AnonymousBootstrapRequestSchema = Type.Object(
  {
    siteKey: OpaqueIdSchema,
    browserIdentity: Type.Optional(OpaqueIdSchema),
  },
  { additionalProperties: false },
);
export type AnonymousBootstrapRequest = Static<typeof AnonymousBootstrapRequestSchema>;

export const IdentityExchangeRequestSchema = Type.Object(
  {
    siteKey: OpaqueIdSchema,
    assertion: Type.String({ minLength: 1, maxLength: 8192 }),
  },
  { additionalProperties: false },
);
export type IdentityExchangeRequest = Static<typeof IdentityExchangeRequestSchema>;

export const SessionBootstrapResponseSchema = Type.Object(
  {
    accessToken: Type.String({ minLength: 1, maxLength: 8192 }),
    tokenType: Type.Literal('Bearer'),
    expiresAt: TimestampSchema,
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    principal: PrincipalSchema,
    sessionId: OpaqueIdSchema,
    browserIdentity: Type.Optional(OpaqueIdSchema),
  },
  { additionalProperties: false },
);
export type SessionBootstrapResponse = Static<typeof SessionBootstrapResponseSchema>;

export const identitySchemaArtifacts = {
  'access-scope': AccessScopeSchema,
  'anonymous-bootstrap-request': AnonymousBootstrapRequestSchema,
  'browser-session': BrowserSessionSchema,
  'identity-assertion': IdentityAssertionSchema,
  'identity-exchange-request': IdentityExchangeRequestSchema,
  principal: PrincipalSchema,
  'session-bootstrap-response': SessionBootstrapResponseSchema,
  'session-token-claims': SessionTokenClaimsSchema,
  site: SiteSchema,
  tenant: TenantSchema,
} as const;
