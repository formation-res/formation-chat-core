import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AdminTokenService } from './token.js';

export const ADMIN_SESSION_COOKIE = 'formation_chat_core_admin_session';

export interface AdminSsoConfig {
  tenantId: string;
  ssoBaseUrl: string;
  ssoUiUrl: string;
  ssoAppId: string;
  appLabel: string;
  callbackUrl: string;
  dashboardUrl: string;
  allowedAdminEmails: string[];
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class AdminAuthService {
  constructor(
    readonly config: AdminSsoConfig,
    private readonly tokens: AdminTokenService,
    private readonly fetch: Fetch = globalThis.fetch,
  ) {}

  get tokenTtlSeconds(): number {
    return this.tokens.ttlSeconds;
  }

  loginUrl(): string {
    const url = new URL(this.config.ssoUiUrl);
    url.search = new URLSearchParams({
      appId: this.config.ssoAppId,
      appLabel: this.config.appLabel,
      returnTo: this.config.callbackUrl,
      returnMode: 'query',
    }).toString();
    return url.toString();
  }

  async exchange(
    loginToken: string,
  ): Promise<{ token: string; email: string; displayName: string }> {
    const response = await this.fetch(`${this.config.ssoBaseUrl}/sso/session/exchange`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        exchangeToken: loginToken,
        appId: this.config.ssoAppId,
        returnTo: this.config.callbackUrl,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('SSO exchange failed.');
    const payload: unknown = await response.json();
    const user = isRecord(payload) && isRecord(payload.apiUser) ? payload.apiUser : undefined;
    const emails = user && Array.isArray(user.emails) ? user.emails : [];
    const fallbackEmail = user?.email ?? user?.primaryEmail;
    const email = [...emails, fallbackEmail]
      .find((value) => typeof value === 'string' && value.trim())
      ?.trim()
      .toLowerCase();
    if (!email || !this.config.allowedAdminEmails.includes(email)) {
      throw new AdminAccessDeniedError();
    }
    const firstName = stringValue(user?.firstName);
    const lastName = stringValue(user?.lastName);
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || email;
    const adminId = `sso-${createHash('sha256').update(email).digest('base64url')}`;
    const issued = await this.tokens.issue({
      adminId,
      tenantId: this.config.tenantId,
      email,
      displayName,
      scopes: ['admin:read', 'admin:internal'],
    });
    return { token: issued.token, email, displayName };
  }

  async renew(token: string) {
    const claims = await this.tokens.verify(token);
    return this.tokens.issue({
      adminId: claims.adminId,
      tenantId: claims.tenantId,
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.displayName ? { displayName: claims.displayName } : {}),
      scopes: claims.scopes,
    });
  }
}

export class AdminAccessDeniedError extends Error {}

export function registerAdminAuthRoutes(server: FastifyInstance, auth: AdminAuthService): void {
  server.get('/auth/login', async (_request, reply) => reply.redirect(auth.loginUrl(), 303));

  server.get('/auth/callback', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const appId = query.app ?? query.appId;
    const loginToken = query.logintoken ?? query.exchangeToken;
    if (
      appId !== auth.config.ssoAppId ||
      typeof loginToken !== 'string' ||
      loginToken.length < 8 ||
      loginToken.length > 4096
    ) {
      return reply.redirect('/dashboard?authError=authentication_failed', 303);
    }
    try {
      const session = await auth.exchange(loginToken);
      void reply.header('set-cookie', sessionCookie(session.token, auth.tokenTtlSeconds));
      return reply.redirect('/dashboard', 303);
    } catch (error) {
      const reason =
        error instanceof AdminAccessDeniedError ? 'access_denied' : 'authentication_failed';
      return reply.redirect(`/dashboard?authError=${reason}`, 303);
    }
  });

  server.get('/auth/session', async (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const token = cookieValue(request, ADMIN_SESSION_COOKIE);
    if (!token) return reply.code(401).send({ authenticated: false });
    try {
      const renewed = await auth.renew(token);
      const claims = renewed.claims;
      void reply.header('set-cookie', sessionCookie(renewed.token, auth.tokenTtlSeconds));
      return {
        authenticated: true,
        email: claims.email ?? '',
        displayName: claims.displayName ?? claims.email ?? 'Dashboard admin',
        role: claims.scopes.includes('admin:internal') ? 'Administrator' : 'Operator',
        expiresAt: claims.expiresAt,
      };
    } catch {
      void reply.header('set-cookie', clearSessionCookie());
      return reply.code(401).send({ authenticated: false });
    }
  });

  server.post('/auth/logout', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== new URL(auth.config.dashboardUrl).origin) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Origin not allowed.' } });
    }
    void reply.header('set-cookie', clearSessionCookie());
    return reply.code(204).send();
  });
}

export function adminTokenFromRequest(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return cookieValue(request, ADMIN_SESSION_COOKIE);
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function sessionCookie(token: string, ttlSeconds: number): string {
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
