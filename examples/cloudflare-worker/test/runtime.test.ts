import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare runtime gateway', () => {
  it('preserves SSE bytes and headers through the deployed handler', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message.delta\n'));
        controller.enqueue(new TextEncoder().encode('data: {"delta":"done"}\n\n'));
        controller.close();
      },
    });
    let upstreamRequest: Request | undefined;
    vi.stubGlobal('fetch', async (request: Request) => {
      upstreamRequest = request;
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    });

    const response = await exports.default.fetch(
      new Request('https://www.example.com/v1/conversations/conversation-1/events', {
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer browser-session-token',
          Origin: 'https://www.example.com',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer browser-session-token');
    expect(upstreamRequest?.headers.get('x-formation-chat-service-token')).toBe(
      'runtime-test-secret',
    );
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let body = '';
    for (;;) {
      const result = await reader?.read();
      if (!result || result.done) break;
      body += decoder.decode(result.value, { stream: true });
    }
    expect(body).toBe('event: message.delta\ndata: {"delta":"done"}\n\n');
  });
});
