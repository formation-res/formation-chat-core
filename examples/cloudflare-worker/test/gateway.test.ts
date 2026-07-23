import { describe, expect, it, vi } from 'vitest';

import { handleGatewayRequest, type GatewayEnv } from '../src/index.js';

const env: GatewayEnv = {
  CHAT_CORE_BASE_URL: 'https://core.example.test',
  CHAT_SITES: JSON.stringify({
    'chat.example.test': {
      siteKey: 'trusted-site',
      allowedOrigins: ['https://chat.example.test'],
      dashboardOrigins: ['https://dashboard.example.test'],
      widget: {
        widgetKey: 'main-chat',
        version: '2026-07-23',
        defaultAgent: 'support',
        theme: 'earth',
        launcher: 'agent',
        placement: 'bottom-right',
        agentAliases: {
          support: { siteKey: 'trusted-site', label: 'Support' },
          sales: { siteKey: 'sales-site', label: 'Sales' },
        },
      },
    },
  }),
  CHAT_CORE_SERVICE_TOKEN: 'worker-secret',
};

describe('Cloudflare chat gateway', () => {
  it('maps the request hostname to a trusted site and strips untrusted routing headers', async () => {
    let upstreamRequest: Request | undefined;
    const fetchUpstream = vi.fn(async (request: Request) => {
      upstreamRequest = request;
      return Response.json({ ok: true });
    });
    const request = jsonRequest('/v1/sessions', {
      browserIdentity: 'browser-1',
      siteKey: 'attacker-site',
      tenantId: 'attacker-tenant',
    });
    request.headers.set('X-Tenant-Id', 'attacker-tenant');
    request.headers.set('X-Site-Key', 'attacker-site');
    request.headers.set('X-Site-Id', 'attacker-site-id');
    request.headers.set('X-Agent-Ref', 'attacker-agent');
    request.headers.set('X-Connector', 'attacker-connector');
    request.headers.set('X-Forwarded-For', '203.0.113.8');
    request.headers.set('Authorization', 'Bearer attacker-token');

    const response = await handleGatewayRequest(request, env, { fetch: fetchUpstream });

    expect(response.status).toBe(200);
    expect(upstreamRequest?.url).toBe('https://core.example.test/v1/sessions');
    expect(await upstreamRequest?.json()).toEqual({
      browserIdentity: 'browser-1',
      siteKey: 'trusted-site',
    });
    expect(upstreamRequest?.headers.get('x-formation-chat-service-token')).toBe('worker-secret');
    expect(upstreamRequest?.headers.get('x-tenant-id')).toBeNull();
    expect(upstreamRequest?.headers.get('x-site-id')).toBeNull();
    expect(upstreamRequest?.headers.get('x-agent-ref')).toBeNull();
    expect(upstreamRequest?.headers.get('x-forwarded-for')).toBeNull();
    expect(upstreamRequest?.headers.get('authorization')).toBeNull();
  });

  it('rejects unknown hosts and origins before calling the core', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const unknownHost = jsonRequest('/v1/sessions', {}, 'https://unknown.example.test');
    const unknownOrigin = jsonRequest('/v1/sessions', {}, undefined, 'https://evil.example');

    expect((await handleGatewayRequest(unknownHost, env, { fetch: fetchUpstream })).status).toBe(
      404,
    );
    expect((await handleGatewayRequest(unknownOrigin, env, { fetch: fetchUpstream })).status).toBe(
      403,
    );
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('accepts an origin-less browser GET only when Fetch Metadata proves it is same-origin', async () => {
    const fetchUpstream = vi.fn(async () => Response.json({ ok: true }));
    const sameOrigin = new Request('https://chat.example.test/v1/conversations', {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    const unproven = new Request('https://chat.example.test/v1/conversations');

    expect((await handleGatewayRequest(sameOrigin, env, { fetch: fetchUpstream })).status).toBe(
      200,
    );
    expect((await handleGatewayRequest(unproven, env, { fetch: fetchUpstream })).status).toBe(403);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it('allows only the public chat paths and methods', async () => {
    const fetchUpstream = vi.fn(async () => Response.json({ ok: true }));

    const admin = await handleGatewayRequest(
      request('/v1/admin/conversations', { method: 'GET' }),
      env,
      { fetch: fetchUpstream },
    );
    const wrongMethod = await handleGatewayRequest(
      request('/v1/conversations/conversation-1/events', { method: 'POST' }),
      env,
      { fetch: fetchUpstream },
    );

    expect(admin.status).toBe(403);
    const identityExchange = await handleGatewayRequest(
      jsonRequest('/v1/identity/exchange', { externalSubject: 'attacker' }),
      env,
      { fetch: fetchUpstream },
    );
    expect(identityExchange.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET');
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('answers valid CORS preflights and rejects untrusted requested headers', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const valid = request('/v1/conversations/conversation-1/messages', {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key',
      },
    });
    const untrusted = request('/v1/conversations', {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-tenant-id',
      },
    });

    const validResponse = await handleGatewayRequest(valid, env, { fetch: fetchUpstream });
    expect(validResponse.status).toBe(204);
    expect(validResponse.headers.get('access-control-allow-origin')).toBe(
      'https://chat.example.test',
    );
    expect((await handleGatewayRequest(untrusted, env, { fetch: fetchUpstream })).status).toBe(403);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('rejects oversized and non-JSON writes', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const oversized = jsonRequest('/v1/conversations/conversation-1/messages', {
      text: 'x'.repeat(131_073),
    });
    const wrongType = request('/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });

    expect((await handleGatewayRequest(oversized, env, { fetch: fetchUpstream })).status).toBe(413);
    expect((await handleGatewayRequest(wrongType, env, { fetch: fetchUpstream })).status).toBe(415);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('passes SSE response bodies through without consuming them', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: run.started\n'));
      },
    });
    const fetchUpstream = vi.fn(
      async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const response = await handleGatewayRequest(
      request('/v1/conversations/conversation-1/events', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer browser-token',
          'Last-Event-ID': 'event-4',
        },
      }),
      env,
      { fetch: fetchUpstream },
    );

    expect(response.body).toBe(stream);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chat.example.test');
  });

  it('serves public widget configuration without exposing trusted wiring', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();

    const response = await handleGatewayRequest(
      request('/widget/config?widgetKey=main-chat&agent=sales&theme=blue&launcher=text', {
        method: 'GET',
      }),
      env,
      { fetch: fetchUpstream },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('max-age=60');
    expect(await response.json()).toEqual({
      widgetKey: 'main-chat',
      siteKey: 'same-origin-gateway',
      agent: 'sales',
      agentLabel: 'Sales',
      version: '2026-07-23',
      theme: 'blue',
      launcher: 'text',
      placement: 'bottom-right',
      transportBaseUrl: 'https://chat.example.test',
    });
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('rejects unknown widget keys and unauthorized public agent aliases', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();

    expect(
      (
        await handleGatewayRequest(
          request('/widget/config?widgetKey=other', { method: 'GET' }),
          env,
          {
            fetch: fetchUpstream,
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleGatewayRequest(
          request('/widget/config?widgetKey=main-chat&agent=private-admin', { method: 'GET' }),
          env,
          { fetch: fetchUpstream },
        )
      ).status,
    ).toBe(403);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('resolves a public agent alias to a trusted site key during bootstrap', async () => {
    let upstreamRequest: Request | undefined;
    const fetchUpstream = vi.fn(async (request: Request) => {
      upstreamRequest = request;
      return Response.json({ ok: true });
    });

    const response = await handleGatewayRequest(
      jsonRequest('/v1/sessions?widgetKey=main-chat&agent=sales', {
        browserIdentity: 'browser-1',
        siteKey: 'attacker-site',
        agent: 'private-admin',
      }),
      env,
      { fetch: fetchUpstream },
    );

    expect(response.status).toBe(200);
    expect(await upstreamRequest?.json()).toEqual({
      browserIdentity: 'browser-1',
      siteKey: 'sales-site',
    });
  });

  it('serves an embeddable widget script with safe initialization behavior', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();

    const response = await handleGatewayRequest(request('/widget.js', { method: 'GET' }), env, {
      fetch: fetchUpstream,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/javascript');
    const script = await response.text();
    expect(script).toContain('formationChatWidget');
    expect(script).toContain("createElement('iframe')");
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('forwards protected admin dashboard reads only from configured dashboard origins', async () => {
    let upstreamRequest: Request | undefined;
    const fetchUpstream = vi.fn(async (request: Request) => {
      upstreamRequest = request;
      return Response.json({ ok: true });
    });

    const response = await handleGatewayRequest(
      request('/v1/admin/overview', {
        method: 'GET',
        headers: { Authorization: 'Bearer admin-token', Origin: 'https://dashboard.example.test' },
      }),
      env,
      { fetch: fetchUpstream },
    );
    const publicWebsite = await handleGatewayRequest(
      request('/v1/admin/overview', {
        method: 'GET',
        headers: { Authorization: 'Bearer admin-token', Origin: 'https://chat.example.test' },
      }),
      env,
      { fetch: fetchUpstream },
    );
    const write = await handleGatewayRequest(
      request('/v1/admin/overview', {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-token', Origin: 'https://dashboard.example.test' },
      }),
      env,
      { fetch: fetchUpstream },
    );

    expect(response.status).toBe(200);
    expect(upstreamRequest?.url).toBe('https://core.example.test/v1/admin/overview');
    expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer admin-token');
    expect(upstreamRequest?.headers.get('x-formation-chat-service-token')).toBe('worker-secret');
    expect(publicWebsite.status).toBe(403);
    expect(write.status).toBe(405);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });
});

function request(path: string, init: RequestInit = {}, baseUrl = 'https://chat.example.test') {
  const headers = new Headers(init.headers);
  if (!headers.has('Origin')) headers.set('Origin', 'https://chat.example.test');
  return new Request(`${baseUrl}${path}`, { ...init, headers });
}

function jsonRequest(
  path: string,
  body: unknown,
  baseUrl?: string,
  origin = 'https://chat.example.test',
) {
  return request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    },
    baseUrl,
  );
}
