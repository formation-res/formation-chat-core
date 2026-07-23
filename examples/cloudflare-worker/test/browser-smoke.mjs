/* global Headers, Request, Response, URL */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { chromium } from 'playwright-core';

import { handleGatewayRequest } from '../dist/index.js';

const directory = new URL('..', import.meta.url).pathname;
const output = join(directory, 'dist/site');
const executablePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const requests = [];
let baseUrl = '';
let env;
const certificateDirectory = mkdtempSync(join(tmpdir(), 'formation-worker-widget-cert-'));
const keyPath = join(certificateDirectory, 'key.pem');
const certificatePath = join(certificateDirectory, 'cert.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-sha256',
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ],
  { stdio: 'ignore' },
);

const server = createServer(
  { key: await readFile(keyPath), cert: await readFile(certificatePath) },
  async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? '/', baseUrl);
      if (url.pathname === '/host') {
        outgoing.setHeader('content-type', 'text/html; charset=utf-8');
        outgoing.end(hostPage(url.searchParams.get('agent') ?? 'support'));
        return;
      }
      if (url.pathname === '/favicon.ico') {
        outgoing.statusCode = 204;
        outgoing.end();
        return;
      }
      if (
        url.pathname === '/widget.js' ||
        url.pathname === '/widget/config' ||
        url.pathname.startsWith('/v1/')
      ) {
        const response = await handleGatewayRequest(await toRequest(incoming, url), env, {
          fetch: coreFetch,
        });
        await sendResponse(outgoing, response);
        return;
      }
      await sendStatic(outgoing, url.pathname);
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(error instanceof Error ? error.message : String(error));
    }
  },
);

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');
  baseUrl = `https://127.0.0.1:${address.port}`;
  env = {
    CHAT_CORE_BASE_URL: 'https://core.example.test',
    CHAT_CORE_SERVICE_TOKEN: 'browser-smoke-service-token',
    CHAT_SITES: JSON.stringify({
      '127.0.0.1': {
        siteKey: 'trusted-site',
        allowedOrigins: [baseUrl],
        dashboardOrigins: [baseUrl],
        widget: {
          widgetKey: 'main-chat',
          version: '2026-07-23',
          defaultAgent: 'support',
          theme: 'earth',
          launcher: 'agent',
          placement: 'bottom-right',
          agentAliases: {
            support: { siteKey: 'trusted-site', label: 'Support' },
            sales: { siteKey: 'trusted-site', label: 'Sales' },
          },
        },
      },
    }),
  };

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await exerciseAlias(context, 'support', 'Support');
  await exerciseAlias(context, 'sales', 'Sales');

  const sessionAliases = requests
    .filter(({ path }) => path === '/v1/sessions')
    .map(({ body }) => body.agentAlias)
    .sort();
  assert.deepEqual(sessionAliases, ['sales', 'support']);
  assert.ok(
    requests.every(
      ({ body }) =>
        !body ||
        (!('tenantId' in body) &&
          !('siteId' in body) &&
          !('agentRef' in body) &&
          !('connectorToken' in body)),
    ),
  );
  process.stdout.write(
    'Shared Worker widget browser smoke passed for support and sales aliases.\n',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

async function exerciseAlias(context, agent, label) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 768 });
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      if (message.text().startsWith('Failed to load resource:')) return;
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  await page.goto(`${baseUrl}/host?agent=${agent}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: label }).click();
  const frame = page.frameLocator(`iframe[title="${label} chat"]`);
  await frame.getByRole('heading', { name: 'Ask Formation' }).waitFor();
  await frame.getByRole('textbox', { name: 'Message' }).fill(`Hello from ${agent}`);
  await frame.getByRole('textbox', { name: 'Message' }).press('Enter');
  await frame.getByLabel('You').getByText(`Hello from ${agent}`).waitFor();
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}.png`),
    fullPage: true,
  });
  assert.deepEqual(problems, []);
  await page.close();
}

function hostPage(agent) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Widget host</title>
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body>
    <h1>Widget host</h1>
    <script src="/widget.js" data-widget-key="main-chat" data-agent="${agent}" data-theme="earth" async></script>
  </body>
</html>`;
}

async function sendStatic(outgoing, path) {
  const file = path === '/' ? join(output, 'index.html') : join(output, path.slice(1));
  try {
    outgoing.setHeader('content-type', contentType(file));
    outgoing.end(await readFile(file));
  } catch {
    outgoing.statusCode = 404;
    outgoing.end();
  }
}

function contentType(path) {
  const extension = extname(path);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.map') return 'application/json';
  return 'text/javascript; charset=utf-8';
}

async function toRequest(incoming, url) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, value);
  }
  const body =
    incoming.method === 'GET' || incoming.method === 'HEAD'
      ? undefined
      : Buffer.concat(await Array.fromAsync(incoming));
  return new Request(url, {
    method: incoming.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function sendResponse(outgoing, response) {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    outgoing.write(Buffer.from(value));
  }
  outgoing.end();
}

async function coreFetch(request) {
  const url = new URL(request.url);
  const body = await readRequestJson(request);
  requests.push({ method: request.method, path: url.pathname, body });
  const agentRef = body?.agentAlias === 'sales' ? 'agent-sales' : 'agent-support';
  const conversation = conversationFor(agentRef);
  if (url.pathname === '/v1/sessions') {
    return Response.json({
      accessToken: `token-${agentRef}`,
      tokenType: 'Bearer',
      expiresAt: '2026-07-23T12:30:00.000Z',
      tenantId: 'tenant-browser',
      siteId: 'site-browser',
      agentRef,
      principal: { kind: 'anonymous', principalId: `principal-${body.agentAlias}` },
      sessionId: `session-${body.agentAlias}`,
      browserIdentity: `browser-${body.agentAlias}`,
    });
  }
  if (url.pathname === '/v1/conversations' && request.method === 'POST') {
    return Response.json(conversation, { status: 201 });
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}`) {
    return Response.json(conversation);
  }
  if (
    url.pathname === `/v1/conversations/${conversation.conversationId}/messages` &&
    request.method === 'GET'
  ) {
    return Response.json({
      data: [messageFor(conversation, { parts: [] })],
      pagination: { hasMore: false },
    });
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}/messages`) {
    return Response.json(messageFor(conversation, body));
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}/events`) {
    return new Response('', {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
  return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
}

async function readRequestJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return undefined;
  return request.json();
}

function conversationFor(agentRef) {
  return {
    conversationId: `conversation-${agentRef}`,
    tenantId: 'tenant-browser',
    siteId: 'site-browser',
    principalId: `principal-${agentRef}`,
    agentRef,
    status: 'active',
    participants: [
      { participantId: `user-${agentRef}`, kind: 'user', principalId: `principal-${agentRef}` },
      { participantId: `agent-${agentRef}`, kind: 'agent', agentRef },
    ],
    createdAt: '2026-07-23T12:00:00.000Z',
    updatedAt: '2026-07-23T12:00:00.000Z',
  };
}

function messageFor(conversation, body) {
  return {
    messageId: `message-${conversation.agentRef}`,
    conversationId: conversation.conversationId,
    sequence: 1,
    participantId: `user-${conversation.agentRef}`,
    role: 'user',
    status: 'completed',
    parts: body.parts,
    createdAt: '2026-07-23T12:00:01.000Z',
    completedAt: '2026-07-23T12:00:01.000Z',
  };
}
