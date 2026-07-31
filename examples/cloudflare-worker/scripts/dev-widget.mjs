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
const widgetStyles = {
  'hot-pink': 'Hot pink',
  blue: 'Blue',
  'dark-green': 'Dark green',
  light: 'Light',
  'rgb-neon': 'RGB neon',
};
const standardPreviewResponse = [
  '## Markdown preview',
  '',
  'This shorter reply includes **bold**, _italic_, and `inline code` while still giving the message bubble enough content to wrap naturally.',
  '',
  '```ts',
  'const preview = "ready";',
  '```',
  '',
  '| Example | Markdown |',
  '| --- | --- |',
  '| Emphasis | **bold text** |',
  '| Code | `preview()` |',
  '',
  'Send another message to keep building the transcript for scrolling and print tests.',
].join('\n');

export function createWidgetPreviewServer({ assetDirectory = defaultAssetDirectory } = {}) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const reloadClients = new Set();
  /** @type {Map<string, ReturnType<typeof createConversationState>>} */
  const conversationStates = new Map();
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
    closeConversationStreams(conversationStates);
  });
  server.notifyReload = () => {
    for (const client of reloadClients) client.write('data: reload\n\n');
  };
  server.closePreviewStreams = () => closeConversationStreams(conversationStates);
  return server;

  function stateFor(agent) {
    let state = conversationStates.get(agent);
    if (!state) {
      state = createConversationState(agent);
      conversationStates.set(agent, state);
    }
    return state;
  }

  async function mockChatCoreResponse(request, response, url) {
    const agent = previewAgent(request, url);
    const state = stateFor(agent);
    const { conversation } = state;
    const body = await readJsonBody(request);

    if (url.pathname === '/v1/sessions' && request.method === 'POST') {
      sendJson(response, 200, {
        accessToken: `local-preview-token-${agent}`,
        tokenType: 'Bearer',
        expiresAt: '2099-01-01T00:00:00.000Z',
        tenantId: 'local-widget-preview',
        siteId: 'local-widget-preview',
        agentRef: conversation.agentRef,
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
      sendJson(response, 200, { data: state.messages, pagination: { hasMore: false } });
      return;
    }
    if (
      url.pathname === `/v1/conversations/${conversation.conversationId}/messages` &&
      request.method === 'POST'
    ) {
      const exchange = appendExchange(state, body);
      sendJson(response, 201, exchange.userMessage);
      publishEvents(state, exchange.events);
      return;
    }
    if (url.pathname === `/v1/conversations/${conversation.conversationId}/events`) {
      openEventStream(request, response, state);
      return;
    }
    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }
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
    server.closePreviewStreams();
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

function previewAgent(request, url) {
  if (url.searchParams.get('agent') === 'sales') return 'sales';
  return request.headers.authorization === 'Bearer local-preview-token-sales' ? 'sales' : 'support';
}

function createConversationState(agent) {
  return { conversation: conversationFor(agent), messages: [], events: [], clients: new Set() };
}

function appendExchange(state, body) {
  const exchangeNumber = state.messages.length / 2 + 1;
  const agent = state.conversation.agentRef.replace(/^local-/, '');
  const occurredAt = new Date().toISOString();
  const userMessage = {
    messageId: `local-user-message-${agent}-${exchangeNumber}`,
    conversationId: state.conversation.conversationId,
    sequence: state.messages.length + 1,
    participantId: `local-user-${agent}`,
    role: 'user',
    status: 'completed',
    parts: Array.isArray(body.parts) ? body.parts : [],
    createdAt: occurredAt,
    completedAt: occurredAt,
  };
  const assistantMessage = {
    messageId: `local-assistant-message-${agent}-${exchangeNumber}`,
    conversationId: state.conversation.conversationId,
    sequence: state.messages.length + 2,
    participantId: `local-agent-${agent}`,
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: standardPreviewResponse }],
    createdAt: occurredAt,
    completedAt: occurredAt,
  };
  state.messages.push(userMessage, assistantMessage);
  const runId = `local-run-${agent}-${exchangeNumber}`;
  let nextEventSequence = state.events.length + 1;
  const common = {
    occurredAt,
    visibility: 'public',
    conversationId: state.conversation.conversationId,
    runId,
  };
  const event = (type, data, messageId) => ({
    ...common,
    eventId: `local-event-${agent}-${nextEventSequence}`,
    sequence: nextEventSequence++,
    type,
    ...(messageId ? { messageId } : {}),
    data,
  });
  const events = [
    event('run.started', { agentRef: state.conversation.agentRef }),
    event('message.started', { role: 'assistant' }, assistantMessage.messageId),
    event('message.delta', { delta: standardPreviewResponse }, assistantMessage.messageId),
    event('message.completed', { parts: assistantMessage.parts }, assistantMessage.messageId),
    event('run.completed', {}),
  ];
  state.events.push(...events);
  return { userMessage, events };
}

function openEventStream(request, response, state) {
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  });
  response.write(': connected\n\n');
  const lastEventId = request.headers['last-event-id'];
  const lastIndex =
    typeof lastEventId === 'string'
      ? state.events.findIndex((event) => event.eventId === lastEventId)
      : -1;
  for (const event of state.events.slice(lastIndex + 1)) response.write(eventFrame(event));
  state.clients.add(response);
  response.once('close', () => state.clients.delete(response));
}

function publishEvents(state, events) {
  for (const client of state.clients) {
    for (const event of events) client.write(eventFrame(event));
  }
}

function eventFrame(event) {
  return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function closeConversationStreams(states) {
  for (const state of states.values()) {
    for (const client of state.clients) client.end();
    state.clients.clear();
  }
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
  const colorMode = safeParameter(searchParams.get('colorMode'), ['light', 'dark'], 'light');
  const placement = safeParameter(
    searchParams.get('placement'),
    ['bottom-right', 'bottom-left'],
    'bottom-right',
  );
  return `<!doctype html>
<html lang="en" data-color-mode="${colorMode}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shared widget local preview</title>
    <link rel="icon" href="/favicon.svg">
    <style>
      :root { color-scheme: light; --preview-bg: #f6f1e7; --preview-control: #fffaf1; --preview-line: #c9bdab; --preview-text: #29241f; }
      :root[data-color-mode="dark"] { color-scheme: dark; --preview-bg: #171513; --preview-control: #25211e; --preview-line: #51483f; --preview-text: #f6f1e7; }
      body { margin: 0; min-height: 100vh; background: var(--preview-bg); color: var(--preview-text); font: 16px/1.5 system-ui, sans-serif; }
      main { max-width: 48rem; padding: 4rem 2rem; }
      code { background: color-mix(in srgb, var(--preview-text) 10%, transparent); border-radius: .25rem; padding: .1rem .35rem; }
      .preview-controls { align-items: end; display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; margin-top: 2rem; }
      .control { display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
      select { background: var(--preview-control); border: 1px solid var(--preview-line); border-radius: .4rem; color: inherit; font: inherit; min-width: 10rem; padding: .55rem .75rem; }
      .mode-switch { align-items: center; cursor: pointer; display: flex; font-size: .9rem; font-weight: 650; gap: .55rem; min-height: 2.55rem; }
      .mode-switch input { height: 1.15rem; margin: 0; width: 1.15rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Shared widget local preview</h1>
      <p>This page uses the current uncommitted shared widget bundle and deterministic mock replies.</p>
      <p>Edit files under <code>examples/cloudflare-worker/site</code>; this page reloads after a successful rebuild.</p>
      <form class="preview-controls" aria-label="Widget preview controls">
        <label class="control" for="widget-style"><span>Widget style</span>
          <select id="widget-style" name="theme">${styleOptions(theme)}</select>
        </label>
        <label class="mode-switch" for="dark-mode">
          <input id="dark-mode" type="checkbox"${colorMode === 'dark' ? ' checked' : ''}>
          <span>Dark mode</span>
        </label>
      </form>
    </main>
    <script type="module" src="/widget.js" data-widget-key="main-chat" data-agent="${agent}" data-theme="${theme}" data-color-mode="${colorMode}" data-launcher="${launcher}" data-placement="${placement}" data-privacy-policy-url="/privacy" async></script>
    <script>
      const styleControl = document.querySelector("#widget-style");
      const darkModeControl = document.querySelector("#dark-mode");
      const updatePreview = (name, value, attributeName) => {
        const url = new URL(location.href);
        url.searchParams.set(name, value);
        history.replaceState(null, "", url);
        const widget = document.querySelector("formation-chat-widget");
        if (widget) widget.setAttribute(attributeName, value);
      };
      styleControl.addEventListener("change", () => updatePreview("theme", styleControl.value, "theme"));
      darkModeControl.addEventListener("change", () => {
        const colorMode = darkModeControl.checked ? "dark" : "light";
        document.documentElement.dataset.colorMode = colorMode;
        updatePreview("colorMode", colorMode, "color-mode");
      });
    </script>
    <script>new EventSource("/__dev/events").onmessage = () => location.reload();</script>
  </body>
</html>`;
}

function styleOptions(selected) {
  return Object.entries(widgetStyles)
    .map(
      ([value, label]) =>
        `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
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
