import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const exampleDirectory = join(scriptDirectory, '..');
const siteDirectory = join(exampleDirectory, 'site');
const defaultAssetDirectory = join(exampleDirectory, 'dist/site');
const agentLabels = { support: 'Support', sales: 'Sales' };

export function createWidgetPreviewServer({ assetDirectory = defaultAssetDirectory } = {}) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const reloadClients = new Set();
  const server = createServer(async (request, response) => {
    try {
      const origin = requestOrigin(request);
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname === '/') {
        send(response, 200, hostPage(url.searchParams), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/__dev/events') {
        response.writeHead(200, {
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Content-Type': 'text/event-stream',
        });
        response.write(': connected\n\n');
        reloadClients.add(response);
        request.once('close', () => reloadClients.delete(response));
        return;
      }
      if (url.pathname === '/widget/config') {
        widgetConfiguration(response, url, origin);
        return;
      }
      if (url.pathname.startsWith('/v1/')) {
        await mockChatCoreResponse(request, response, url);
        return;
      }
      await sendStaticAsset(response, assetDirectory, url.pathname);
    } catch (error) {
      send(
        response,
        500,
        error instanceof Error ? error.message : 'Widget preview failed.',
        'text/plain; charset=utf-8',
      );
    }
  });
  server.once('close', () => {
    for (const client of reloadClients) client.end();
    reloadClients.clear();
  });
  server.notifyReload = () => {
    for (const client of reloadClients) client.write('data: reload\n\n');
  };
  return server;
}

async function startWidgetPreview() {
  await buildSite();
  const port = parsePort(process.env.WIDGET_DEV_PORT ?? '8791');
  const host = '127.0.0.1';
  const server = createWidgetPreviewServer();
  const sourceWatcher = watch(siteDirectory, { recursive: true }, scheduleBuild);
  let buildTimer;
  let building = false;
  let buildQueued = false;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  process.stdout.write(
    `\nShared widget preview: http://${host}:${port}\n` +
      `Watching examples/cloudflare-worker/site for changes. Stop with Ctrl+C.\n\n`,
  );

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  function scheduleBuild() {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(() => void rebuild(), 120);
  }

  async function rebuild() {
    if (building) {
      buildQueued = true;
      return;
    }
    building = true;
    try {
      await buildSite();
      server.notifyReload();
      process.stdout.write('Widget rebuilt; browser reloaded.\n');
    } catch (error) {
      process.stderr.write(
        `Widget rebuild failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      building = false;
      if (buildQueued) {
        buildQueued = false;
        scheduleBuild();
      }
    }
  }

  function stop() {
    clearTimeout(buildTimer);
    sourceWatcher.close();
    server.close(() => process.exit(0));
  }
}

async function buildSite() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scriptDirectory, 'build-site.mjs')], {
      cwd: exampleDirectory,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve(undefined) : reject(new Error(`build exited with code ${code ?? 1}`)),
    );
  });
}

function requestOrigin(request) {
  const host = request.headers.host ?? '127.0.0.1';
  return `http://${host}`;
}

function widgetConfiguration(response, url, origin) {
  const widgetKey = url.searchParams.get('widgetKey') ?? 'main-chat';
  const agent = url.searchParams.get('agent') ?? 'support';
  if (widgetKey !== 'main-chat') {
    sendJson(response, 404, { error: { code: 'WIDGET_NOT_FOUND', message: 'Widget not found.' } });
    return;
  }
  const agentLabel = agentLabels[agent];
  if (!agentLabel) {
    sendJson(response, 403, {
      error: { code: 'AGENT_NOT_ALLOWED', message: 'Agent not allowed.' },
    });
    return;
  }
  sendJson(response, 200, {
    widgetKey,
    siteKey: 'local-widget-preview',
    agent,
    agentLabel,
    version: url.searchParams.get('version') ?? 'local',
    theme: url.searchParams.get('theme') ?? 'hot-pink',
    launcher: url.searchParams.get('launcher') ?? 'agent',
    placement: url.searchParams.get('placement') ?? 'bottom-right',
    transportBaseUrl: origin,
  });
}

async function mockChatCoreResponse(request, response, url) {
  const agent = previewAgent(request, url);
  const agentRef = `local-${agent}`;
  const conversation = conversationFor(agent);
  const body = await readJsonBody(request);

  if (url.pathname === '/v1/sessions' && request.method === 'POST') {
    sendJson(response, 200, {
      accessToken: `local-preview-token-${agent}`,
      tokenType: 'Bearer',
      expiresAt: '2099-01-01T00:00:00.000Z',
      tenantId: 'local-widget-preview',
      siteId: 'local-widget-preview',
      agentRef,
      principal: { kind: 'anonymous', principalId: `local-principal-${agent}` },
      sessionId: `local-session-${agent}`,
      browserIdentity: `local-browser-${agent}`,
    });
    return;
  }
  if (url.pathname === '/v1/conversations' && request.method === 'POST') {
    sendJson(response, 201, conversation);
    return;
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}`) {
    sendJson(response, 200, conversation);
    return;
  }
  if (
    url.pathname === `/v1/conversations/${conversation.conversationId}/messages` &&
    request.method === 'GET'
  ) {
    sendJson(response, 200, { data: [], pagination: { hasMore: false } });
    return;
  }
  if (
    url.pathname === `/v1/conversations/${conversation.conversationId}/messages` &&
    request.method === 'POST'
  ) {
    sendJson(response, 201, messageFor(conversation, body));
    return;
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}/events`) {
    send(response, 200, eventStream(conversation), 'text/event-stream; charset=utf-8', {
      'Cache-Control': 'no-cache',
    });
    return;
  }
  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.includes('application/json')) return {};
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function conversationFor(agent) {
  const agentRef = `local-${agent}`;
  return {
    conversationId: `local-conversation-${agent}`,
    tenantId: 'local-widget-preview',
    siteId: 'local-widget-preview',
    principalId: `local-principal-${agent}`,
    agentRef,
    status: 'active',
    participants: [
      {
        participantId: `local-user-${agent}`,
        kind: 'user',
        principalId: `local-principal-${agent}`,
      },
      { participantId: `local-agent-${agent}`, kind: 'agent', agentRef },
    ],
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  };
}

function messageFor(conversation, body) {
  const agent = conversation.agentRef.replace(/^local-/, '');
  return {
    messageId: `local-message-${conversation.agentRef}`,
    conversationId: conversation.conversationId,
    sequence: 1,
    participantId: `local-user-${agent}`,
    role: 'user',
    status: 'completed',
    parts: Array.isArray(body.parts) ? body.parts : [],
    createdAt: '2026-07-29T12:00:01.000Z',
    completedAt: '2026-07-29T12:00:01.000Z',
  };
}

function previewAgent(request, url) {
  if (url.searchParams.get('agent') === 'sales') return 'sales';
  return request.headers.authorization === 'Bearer local-preview-token-sales' ? 'sales' : 'support';
}

function eventStream(conversation) {
  const event = {
    eventId: `local-event-${conversation.agentRef}`,
    sequence: 1,
    type: 'message.delta',
    occurredAt: '2026-07-29T12:00:02.000Z',
    visibility: 'public',
    conversationId: conversation.conversationId,
    runId: `local-run-${conversation.agentRef}`,
    messageId: `local-assistant-${conversation.agentRef}`,
    data: { delta: 'Hello from the local widget preview.' },
  };
  return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function sendStaticAsset(response, assetDirectory, pathname) {
  const fileName = pathname.slice(1);
  if (!fileName || fileName.includes('/') || fileName.includes('..')) {
    send(response, 404, 'Not found.', 'text/plain; charset=utf-8');
    return;
  }
  try {
    send(response, 200, await readFile(join(assetDirectory, fileName)), contentType(fileName));
  } catch {
    send(response, 404, 'Not found.', 'text/plain; charset=utf-8');
  }
}

function hostPage(searchParams) {
  const agent = safeParameter(searchParams.get('agent'), ['support', 'sales'], 'support');
  const theme = safeParameter(
    searchParams.get('theme'),
    ['hot-pink', 'blue', 'dark-green', 'light', 'rgb-neon'],
    'hot-pink',
  );
  const launcher = safeParameter(searchParams.get('launcher'), ['agent', 'text'], 'agent');
  const placement = safeParameter(
    searchParams.get('placement'),
    ['bottom-right', 'bottom-left'],
    'bottom-right',
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shared widget local preview</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #f6f1e7; color: #29241f; font: 16px/1.5 system-ui, sans-serif; }
      main { max-width: 48rem; padding: 4rem 2rem; }
      code { background: #e8dfd0; border-radius: .25rem; padding: .1rem .35rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Shared widget local preview</h1>
      <p>This page uses the current uncommitted shared widget bundle and deterministic mock replies.</p>
      <p>Edit files under <code>examples/cloudflare-worker/site</code>; this page reloads after a successful rebuild.</p>
    </main>
    <script type="module" src="/widget.js" data-widget-key="main-chat" data-agent="${agent}" data-theme="${theme}" data-launcher="${launcher}" data-placement="${placement}" async></script>
    <script>new EventSource("/__dev/events").onmessage = () => location.reload();</script>
  </body>
</html>`;
}

function safeParameter(value, allowed, fallback) {
  return value && allowed.includes(value) ? value : fallback;
}

function contentType(fileName) {
  const extension = extname(fileName);
  if (extension === '.js' || extension === '.map') return 'text/javascript; charset=utf-8';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function sendJson(response, status, body) {
  send(response, status, JSON.stringify(body), 'application/json; charset=utf-8', {
    'Cache-Control': 'no-store',
  });
}

function send(response, status, body, type, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': type, ...extraHeaders });
  response.end(body);
}

function parsePort(raw) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('WIDGET_DEV_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await startWidgetPreview();
}
