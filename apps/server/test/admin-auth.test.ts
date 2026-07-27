import { describe, expect, it, vi } from 'vitest';

import { AdminAuthService } from '../src/admin/auth.js';
import { AdminTokenService } from '../src/admin/token.js';
import { buildServer } from '../src/server.js';

const tokens = new AdminTokenService('admin-secret-0123456789abcdef0123456789abcdef', 3600);
const config = {
  tenantId: 'formationxyz_com',
  ssoBaseUrl: 'https://api.tryformation.com',
  ssoUiUrl: 'https://sso.tryformation.com/',
  ssoAppId: 'formation-chat-core-dashboard',
  appLabel: 'Chat Core Dashboard',
  callbackUrl: 'https://chat.formationxyz.com/auth/callback',
  dashboardUrl: 'https://chat.formationxyz.com/dashboard',
  allowedAdminEmails: ['jo@tryformation.com', 'jvg@tryformation.com', 'ih@tryformation.com'],
};

describe('admin SSO routes', () => {
  it('redirects to the registered Formation SSO callback', async () => {
    const server = buildServer({
      checkDatabase: async () => undefined,
      logger: false,
      adminAuth: new AdminAuthService(config, tokens, vi.fn()),
    });

    const response = await server.inject({ method: 'GET', url: '/auth/login' });

    expect(response.statusCode).toBe(303);
    const location = new URL(response.headers.location as string);
    expect(location.origin).toBe('https://sso.tryformation.com');
    expect(location.searchParams.get('appId')).toBe('formation-chat-core-dashboard');
    expect(location.searchParams.get('returnTo')).toBe(config.callbackUrl);
    expect(location.searchParams.get('returnMode')).toBe('query');
    await server.close();
  });

  it('exchanges a login token and authenticates with an HTTP-only cookie', async () => {
    const exchange = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            apiUser: {
              emails: ['JO@tryformation.com'],
              firstName: 'Jo',
              lastName: 'Formation',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const server = buildServer({
      checkDatabase: async () => undefined,
      logger: false,
      adminAuth: new AdminAuthService(config, tokens, exchange),
    });

    const callback = await server.inject({
      method: 'GET',
      url: '/auth/callback?app=formation-chat-core-dashboard&logintoken=one-time-token',
    });

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/dashboard');
    expect(callback.headers['set-cookie']).toMatch(
      /^formation_chat_core_admin_session=.*HttpOnly.*Secure.*SameSite=Lax/,
    );
    expect(exchange).toHaveBeenCalledOnce();
    const cookie = String(callback.headers['set-cookie']).split(';', 1)[0] as string;
    const session = await server.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      authenticated: true,
      email: 'jo@tryformation.com',
      displayName: 'Jo Formation',
    });
    await server.close();
  });

  it('does not create a session for an email outside the admin allowlist', async () => {
    const server = buildServer({
      checkDatabase: async () => undefined,
      logger: false,
      adminAuth: new AdminAuthService(
        config,
        tokens,
        vi.fn(
          async () =>
            new Response(JSON.stringify({ apiUser: { emails: ['visitor@example.com'] } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      ),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/auth/callback?app=formation-chat-core-dashboard&logintoken=one-time-token',
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/dashboard?authError=access_denied');
    expect(response.headers['set-cookie']).toBeUndefined();
    await server.close();
  });
});
