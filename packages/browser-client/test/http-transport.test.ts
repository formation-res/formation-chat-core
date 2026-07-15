import type { Message, PublicConversationEvent } from '@formation-chat-core/protocol';
import { describe, expect, it, vi } from 'vitest';

import { createHttpChatTransport, parseEventStream } from '../src/index.js';

const session = {
  accessToken: 'secret-token',
  tokenType: 'Bearer' as const,
  expiresAt: '2026-07-15T11:00:00.000Z',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  principal: { kind: 'anonymous' as const, principalId: 'principal-1' },
  sessionId: 'session-1',
  browserIdentity: 'browser-1',
};

const message: Message = {
  messageId: 'message-1',
  conversationId: 'conversation-1',
  sequence: 1,
  participantId: 'user-1',
  role: 'user',
  status: 'completed',
  parts: [{ type: 'text', text: 'Hello' }],
  createdAt: '2026-07-15T10:00:00.000Z',
  completedAt: '2026-07-15T10:00:00.000Z',
};

describe('HTTP chat transport', () => {
  it('rejects unsafe base URLs', () => {
    expect(() => createHttpChatTransport({ baseUrl: 'https://user:secret@chat.example' })).toThrow(
      'without credentials',
    );
  });

  it('keeps the token in memory and applies auth, idempotency, and pagination', async () => {
    const responses = [
      Response.json(session),
      Response.json({ data: [message], pagination: { hasMore: true, nextCursor: 'next-1' } }),
      Response.json({
        data: [{ ...message, messageId: 'message-2', sequence: 2 }],
        pagination: { hasMore: false },
      }),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchAdapter: typeof fetch = vi.fn(async (input, init) => {
      calls.push([input, init]);
      return responses.shift() as Response;
    });
    const transport = createHttpChatTransport({
      baseUrl: 'https://chat.example',
      origin: 'https://site.example',
      fetch: fetchAdapter,
    });
    await transport.bootstrap({ siteKey: 'site-key', idempotencyKey: 'bootstrap-1' });
    const messages = await transport.listMessages('conversation-1');

    expect(messages.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'bootstrap-1',
      Origin: 'https://site.example',
    });
    expect(calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
    });
    expect(String(calls[2]?.[0])).toContain('cursor=next-1');
  });

  it('surfaces safe server errors with their machine code', async () => {
    const transport = createHttpChatTransport({
      baseUrl: 'https://chat.example',
      fetch: vi.fn(async () =>
        Response.json(
          {
            error: {
              code: 'SITE_NOT_FOUND',
              message: 'The site was not found.',
              correlationId: 'request-1',
            },
          },
          { status: 404 },
        ),
      ),
    });
    await expect(
      transport.bootstrap({ siteKey: 'missing', idempotencyKey: 'key-1' }),
    ).rejects.toMatchObject({ code: 'SITE_NOT_FOUND', status: 404 });
  });
});

describe('SSE parser', () => {
  it('handles split chunks and ignores duplicate framing metadata only after validation', async () => {
    const event: PublicConversationEvent = {
      eventId: 'event-1',
      sequence: 1,
      type: 'message.delta',
      visibility: 'public',
      occurredAt: '2026-07-15T10:00:00.000Z',
      conversationId: 'conversation-1',
      runId: 'run-1',
      messageId: 'message-1',
      data: { delta: 'Hi' },
    };
    const frame = `id: event-1\r\nevent: message.delta\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
    const bytes = new TextEncoder().encode(frame);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    });
    const received: PublicConversationEvent[] = [];
    await parseEventStream(stream, (value) => {
      received.push(value);
    });
    expect(received).toEqual([event]);
  });

  it('rejects invalid or oversized public frames', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: event-1\ndata: {}\n\n'));
        controller.close();
      },
    });
    await expect(parseEventStream(stream, () => undefined, { maxFrameBytes: 8 })).rejects.toThrow(
      'maximum',
    );
  });
});
