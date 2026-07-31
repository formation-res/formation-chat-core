import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWidgetPreviewServer } from '../scripts/dev-widget.mjs';

const servers: Array<ReturnType<typeof createWidgetPreviewServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closePreviewStreams();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }),
  );
});

describe('shared widget local preview', () => {
  it('serves the current widget with mock Chat Core responses', async () => {
    const assetDirectory = await mkdtemp(join(tmpdir(), 'formation-widget-preview-'));
    await writeFile(
      join(assetDirectory, 'widget.js'),
      'customElements.define("preview-widget", class extends HTMLElement {})',
    );
    const server = createWidgetPreviewServer({ assetDirectory });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Preview server did not start.');
    const origin = `http://127.0.0.1:${address.port}`;

    const hostPage = await fetch(`${origin}/?colorMode=dark&theme=dark-green`).then((response) =>
      response.text(),
    );
    expect(hostPage).toContain('src="/widget.js"');
    expect(hostPage).toContain('new EventSource("/__dev/events")');
    expect(hostPage).toContain('id="widget-style"');
    expect(hostPage).toContain('<option value="dark-green" selected>Dark green</option>');
    expect(hostPage).toContain('id="dark-mode" type="checkbox" checked');
    expect(hostPage).toContain('data-theme="dark-green"');
    expect(hostPage).toContain('data-color-mode="dark"');
    expect(hostPage).toContain('history.replaceState');
    expect(hostPage).toContain('widget.setAttribute(attributeName, value)');
    expect(hostPage).not.toContain('location.assign');

    const widget = await fetch(`${origin}/widget.js`);
    expect(widget.status).toBe(200);
    expect(widget.headers.get('content-type')).toContain('text/javascript');

    const configuration = await fetch(
      `${origin}/widget/config?widgetKey=main-chat&agent=sales`,
    ).then((response) => response.json());
    expect(configuration).toMatchObject({
      widgetKey: 'main-chat',
      siteKey: 'local-widget-preview',
      agent: 'sales',
      agentLabel: 'Sales',
      theme: 'hot-pink',
      transportBaseUrl: origin,
    });

    const unknownAgent = await fetch(`${origin}/widget/config?widgetKey=main-chat&agent=unknown`);
    expect(unknownAgent.status).toBe(403);

    const session = await fetch(`${origin}/v1/sessions?widgetKey=main-chat&agent=support`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteKey: 'browser-value' }),
    }).then((response) => response.json());
    expect(session).toMatchObject({
      siteId: 'local-widget-preview',
      agentRef: 'local-support',
    });

    const events = await fetch(`${origin}/v1/conversations/local-conversation-sales/events`, {
      headers: { authorization: 'Bearer local-preview-token-sales' },
    });
    expect(events.status).toBe(200);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    await events.body?.cancel();
  });

  it('keeps one event stream open and stores repeated mock exchanges', async () => {
    const assetDirectory = await mkdtemp(join(tmpdir(), 'formation-widget-preview-'));
    await writeFile(join(assetDirectory, 'widget.js'), '');
    const server = createWidgetPreviewServer({ assetDirectory });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Preview server did not start.');
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: 'Bearer local-preview-token-support',
      'content-type': 'application/json',
    };

    const eventResponse = await fetch(
      `${origin}/v1/conversations/local-conversation-support/events`,
      { headers },
    );
    const reader = eventResponse.body?.getReader();
    if (!reader) throw new Error('Preview event stream has no body.');

    for (const text of ['First test message', 'Second test message']) {
      const response = await fetch(
        `${origin}/v1/conversations/local-conversation-support/messages`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ parts: [{ type: 'text', text }] }),
        },
      );
      expect(response.status).toBe(201);
    }

    const transcript = (await fetch(
      `${origin}/v1/conversations/local-conversation-support/messages`,
      { headers },
    ).then((response) => response.json())) as {
      data: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
    };
    expect(transcript.data).toHaveLength(4);
    expect(transcript.data.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    const previewResponse = transcript.data[1]?.parts[0]?.text ?? '';
    expect(previewResponse.length).toBeLessThan(500);
    expect(previewResponse).toContain('**bold**');
    expect(previewResponse).toContain('_italic_');
    expect(previewResponse).toContain('```');
    expect(previewResponse).toContain('| Example | Markdown |');

    const decoder = new TextDecoder();
    let events = '';
    while ((events.match(/event: run\.completed/g) ?? []).length < 2) {
      const chunk = await reader.read();
      if (chunk.done) break;
      events += decoder.decode(chunk.value, { stream: true });
    }
    expect(events.match(/event: run\.completed/g)).toHaveLength(2);
    expect(
      await Promise.race([
        reader.closed.then(() => 'closed'),
        new Promise((resolve) => setTimeout(() => resolve('open'), 25)),
      ]),
    ).toBe('open');
    await reader.cancel();
  });
});
