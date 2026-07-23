import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  AnonymousBootstrapRequestSchema,
  IdentityAssertionSchema,
  SessionBootstrapResponseSchema,
  SessionTokenClaimsSchema,
  validateIdentityAssertionContext,
} from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
formatsPlugin.default(ajv);

describe('identity and session contracts', () => {
  it('rejects browser attempts to claim trusted identity or routing fields', () => {
    const validate = ajv.compile(AnonymousBootstrapRequestSchema);

    expect(validate({ siteKey: 'public_site_key', browserIdentity: 'browser_01JY5N7P8Q' })).toBe(
      true,
    );
    expect(
      validate({
        siteKey: 'public_site_key',
        widgetKey: 'main-chat',
        agentAlias: 'support',
      }),
    ).toBe(true);
    expect(validate({ siteKey: 'public_site_key', externalUserId: 'admin' })).toBe(false);
    expect(validate({ siteKey: 'public_site_key', tenantId: 'other_tenant' })).toBe(false);
    expect(validate({ siteKey: 'public_site_key', agentRef: 'privileged_agent' })).toBe(false);
  });

  it('requires complete trusted identity assertion claims', () => {
    const validate = ajv.compile(IdentityAssertionSchema);

    expect(
      validate({
        issuer: 'https://accounts.example.com',
        audience: 'formation-chat-core',
        subject: 'user_123',
        tenantId: 'tenant_01JY5N7P8Q',
        siteId: 'site_01JY5N7P8Q',
        issuedAt: '2026-07-15T12:00:00.000Z',
        expiresAt: '2026-07-15T12:10:00.000Z',
        nonce: 'nonce_01JY5N7P8Q',
      }),
    ).toBe(true);
  });

  it.each([
    ['expired', { expiresAt: '2026-07-15T11:59:59.000Z' }],
    ['wrong audience', { audience: 'another-service' }],
    ['cross-site', { siteId: 'site_other' }],
    ['cross-tenant', { tenantId: 'tenant_other' }],
  ])('rejects %s identity assertions in their trust context', (_name, override) => {
    const claims = {
      issuer: 'https://accounts.example.com',
      audience: 'formation-chat-core',
      subject: 'user_123',
      tenantId: 'tenant_01JY5N7P8Q',
      siteId: 'site_01JY5N7P8Q',
      issuedAt: '2026-07-15T12:00:00.000Z',
      expiresAt: '2026-07-15T12:10:00.000Z',
      nonce: 'nonce_01JY5N7P8Q',
      ...override,
    };

    expect(
      validateIdentityAssertionContext(claims, {
        audience: 'formation-chat-core',
        tenantId: 'tenant_01JY5N7P8Q',
        siteId: 'site_01JY5N7P8Q',
        now: new Date('2026-07-15T12:05:00.000Z'),
      }),
    ).toBe(false);
  });

  it('scopes access tokens to one tenant, site, principal, session, and operation set', () => {
    const validate = ajv.compile(SessionTokenClaimsSchema);

    expect(
      validate({
        tenantId: 'tenant_01JY5N7P8Q',
        siteId: 'site_01JY5N7P8Q',
        agentRef: 'agent_01JY5N7P8Q',
        principalId: 'principal_01JY5N7P8Q',
        sessionId: 'session_01JY5N7P8Q',
        scopes: ['conversations:read', 'conversations:write', 'events:read'],
        issuedAt: '2026-07-15T12:00:00.000Z',
        expiresAt: '2026-07-15T12:10:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects service credentials in bootstrap responses', () => {
    const validate = ajv.compile(SessionBootstrapResponseSchema);
    const response = {
      accessToken: 'short-lived-token',
      tokenType: 'Bearer',
      expiresAt: '2026-07-15T12:10:00.000Z',
      tenantId: 'tenant_01JY5N7P8Q',
      siteId: 'site_01JY5N7P8Q',
      agentRef: 'agent_01JY5N7P8Q',
      principal: { kind: 'anonymous', principalId: 'principal_01JY5N7P8Q' },
      sessionId: 'session_01JY5N7P8Q',
      browserIdentity: 'browser_01JY5N7P8Q',
    };

    expect(validate(response)).toBe(true);
    expect(validate({ ...response, serviceCredential: 'must-not-leak' })).toBe(false);
  });
});
