import { describe, expect, it } from 'vitest';

import { readEventStream } from '../site/stream.js';

describe('widget event stream', () => {
  it('parses SSE events split across network chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: message.delta\ndata: {"type":"message.delta","data":{"del'),
        );
        controller.enqueue(encoder.encode('ta":"Hello"}}\n\nevent: run.completed\n'));
        controller.enqueue(encoder.encode('data: {"type":"run.completed","data":{}}\n\n'));
        controller.close();
      },
    });
    const events: Array<{ type: string; data: unknown }> = [];

    await readEventStream(new Response(stream), (event) => events.push(event));

    expect(events).toEqual([
      { type: 'message.delta', data: { delta: 'Hello' } },
      { type: 'run.completed', data: {} },
    ]);
  });

  it('rejects malformed and oversized event frames', async () => {
    await expect(
      readEventStream(new Response('data: not-json\n\n'), () => undefined),
    ).rejects.toThrow('Invalid event stream');
    await expect(
      readEventStream(new Response(`data: ${'x'.repeat(65_537)}\n\n`), () => undefined),
    ).rejects.toThrow('Event frame is too large');
  });
});
