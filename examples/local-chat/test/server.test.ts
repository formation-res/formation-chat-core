import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalChatServer } from '../scripts/local-server.mjs';

const servers: ReturnType<typeof createServer>[] = [];

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

describe('createLocalChatServer', () => {
  it('serves the UI and injects only the public site key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-chat-static-'));
    await writeFile(join(directory, 'index.html'), '<h1>Local chat</h1>');
    const server = createLocalChatServer({
      coreBaseUrl: new URL('http://127.0.0.1:3000'),
      rootDirectory: directory,
      siteKey: 'local-chat',
    });
    servers.push(server);
    const baseUrl = await listen(server);

    expect(await fetch(baseUrl).then((response) => response.text())).toContain('Local chat');
    expect(await fetch(`${baseUrl}/local-chat-config.js`).then((response) => response.text())).toBe(
      'window.__FORMATION_CHAT_LOCAL_CONFIG__={"siteKey":"local-chat"};',
    );
  });

  it('proxies API requests without buffering or replacing the browser origin', async () => {
    let receivedOrigin: string | undefined;
    let receivedTenantHeader: string | undefined;
    const upstream = createServer((request, response) => {
      receivedOrigin = request.headers.origin;
      receivedTenantHeader = request.headers['x-tenant-id'] as string | undefined;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: first\n\n');
      response.end('data: second\n\n');
    });
    servers.push(upstream);
    const upstreamUrl = await listen(upstream);
    const directory = await mkdtemp(join(tmpdir(), 'local-chat-proxy-'));
    await writeFile(join(directory, 'index.html'), 'ok');
    const server = createLocalChatServer({
      coreBaseUrl: new URL(upstreamUrl),
      rootDirectory: directory,
      siteKey: 'local-chat',
    });
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/v1/conversations/example/events`, {
      headers: { Origin: baseUrl, 'X-Tenant-Id': 'browser-controlled' },
    });

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('data: first\n\ndata: second\n\n');
    expect(receivedOrigin).toBe(baseUrl);
    expect(receivedTenantHeader).toBeUndefined();
  });
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to TCP.');
  return `http://127.0.0.1:${address.port}`;
}
