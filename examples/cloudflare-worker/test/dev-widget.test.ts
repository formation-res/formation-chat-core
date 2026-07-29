import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWidgetPreviewServer } from '../scripts/dev-widget.mjs';

const servers: Array<ReturnType<typeof createWidgetPreviewServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
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

    const hostPage = await fetch(origin).then((response) => response.text());
    expect(hostPage).toContain('src="/widget.js"');
    expect(hostPage).toContain('new EventSource("/__dev/events")');
    expect(hostPage).toContain('data-theme="hot-pink"');

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
    }).then((response) => response.text());
    expect(events).toContain('Hello from the local widget preview.');
    expect(events).toContain('local-conversation-sales');
  });
});
