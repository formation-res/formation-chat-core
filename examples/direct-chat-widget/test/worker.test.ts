import { describe, expect, it, vi } from 'vitest';

import { handleWidgetRequest, type WidgetEnv } from '../src/index.js';

const haystackEnv = {
  BACKEND_MODE: 'haystack',
  ALLOWED_ORIGINS: JSON.stringify(['https://www.example.com']),
  HAYSTACK_BASE_URL: 'https://haystack.example.test',
  HAYSTACK_AGENT_REF: 'trusted-support',
  HAYSTACK_TENANT_KEY: 'trusted_tenant',
  HAYSTACK_AGENT_SLUG: 'trusted-agent',
  HAYSTACK_CONNECTOR_TOKEN: 'connector-secret',
} satisfies WidgetEnv;

describe('direct chat widget Worker', () => {
  it('invokes the default fetch with the Worker global receiver', async () => {
    const upstream = new Response(
      'event: message.delta\ndata: {"data":{"delta":"Hi"}}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
    const fetchUpstream = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(upstream);
    });
    vi.stubGlobal('fetch', fetchUpstream);

    try {
      const response = await handleWidgetRequest(chatRequest(), haystackEnv);

      expect(response.status).toBe(200);
      expect(fetchUpstream).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('constructs a trusted Haystack execution request and keeps its secret server-side', async () => {
    let upstreamRequest: Request | undefined;
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('event: message.delta\ndata: {"data":{"delta":"Hi"}}\n\n'),
        );
        controller.close();
      },
    });
    const fetchUpstream = vi.fn(async (request: Request) => {
      upstreamRequest = request;
      return new Response(upstream, { headers: { 'Content-Type': 'text/event-stream' } });
    });

    const response = await handleWidgetRequest(chatRequest(), haystackEnv, {
      fetch: fetchUpstream,
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe(upstream);
    expect(upstreamRequest?.url).toBe('https://haystack.example.test/api/connectors/v1/runs');
    expect(upstreamRequest?.redirect).toBe('manual');
    expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer connector-secret');
    const body = (await upstreamRequest?.json()) as {
      request: { agentRef: string; trustedMetadata: Record<string, string> };
    };
    expect(body.request.agentRef).toBe('trusted-support');
    expect(body.request.trustedMetadata).toEqual({
      origin: 'https://www.example.com',
      'haystack.tenant_key': 'trusted_tenant',
      'haystack.agent_slug': 'trusted-agent',
    });
    expect(JSON.stringify(body)).not.toContain('attacker-agent');
    expect(await response.text()).not.toContain('connector-secret');
  });

  it('rejects untrusted origins, methods, content types, and oversized histories', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const wrongOrigin = chatRequest({ origin: 'https://evil.example' });
    const wrongMethod = new Request('https://widget.example/api/chat', {
      method: 'GET',
      headers: { Origin: 'https://www.example.com' },
    });
    const wrongType = new Request('https://widget.example/api/chat', {
      method: 'POST',
      headers: { Origin: 'https://www.example.com', 'Content-Type': 'text/plain' },
      body: '{}',
    });
    const tooManyMessages = chatRequest({
      messages: Array.from({ length: 31 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        text: 'message',
      })),
    });

    expect(
      (await handleWidgetRequest(wrongOrigin, haystackEnv, { fetch: fetchUpstream })).status,
    ).toBe(403);
    expect(
      (await handleWidgetRequest(wrongMethod, haystackEnv, { fetch: fetchUpstream })).status,
    ).toBe(405);
    expect(
      (await handleWidgetRequest(wrongType, haystackEnv, { fetch: fetchUpstream })).status,
    ).toBe(415);
    expect(
      (await handleWidgetRequest(tooManyMessages, haystackEnv, { fetch: fetchUpstream })).status,
    ).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('runs without credentials in mock mode for local and preview testing', async () => {
    const env = {
      BACKEND_MODE: 'mock',
      ALLOWED_ORIGINS: haystackEnv.ALLOWED_ORIGINS,
      HAYSTACK_BASE_URL: haystackEnv.HAYSTACK_BASE_URL,
      HAYSTACK_AGENT_REF: haystackEnv.HAYSTACK_AGENT_REF,
      HAYSTACK_TENANT_KEY: haystackEnv.HAYSTACK_TENANT_KEY,
      HAYSTACK_AGENT_SLUG: haystackEnv.HAYSTACK_AGENT_SLUG,
    } satisfies WidgetEnv;
    const response = await handleWidgetRequest(chatRequest(), env, {
      fetch: vi.fn<typeof fetch>(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('event: message.delta');
    expect(body).toContain('This preview is working');
  });

  it('refuses to send the Haystack credential over plaintext HTTP', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const env = { ...haystackEnv, HAYSTACK_BASE_URL: 'http://haystack.example.test' };

    const response = await handleWidgetRequest(chatRequest(), env, { fetch: fetchUpstream });

    expect(response.status).toBe(500);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});

function chatRequest(
  options: {
    origin?: string;
    messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
  } = {},
) {
  return new Request('https://widget.example/api/chat', {
    method: 'POST',
    headers: {
      Origin: options.origin ?? 'https://www.example.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversationId: 'conversation-1',
      visitorId: 'visitor-1',
      agentRef: 'attacker-agent',
      messages: options.messages ?? [{ role: 'user', text: 'Hello' }],
    }),
  });
}
