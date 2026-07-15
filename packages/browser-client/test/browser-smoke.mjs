/* global AbortController, crypto, localStorage, window */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { MockConnector } from '@formation-chat-core/mock-connector';
import { chromium } from 'playwright-core';

import { ConversationService } from '../../../apps/server/dist/conversation/service.js';
import { createDatabase } from '../../../apps/server/dist/database/database.js';
import { migrateDatabase } from '../../../apps/server/dist/database/migrate.js';
import { EventBroker } from '../../../apps/server/dist/event/broker.js';
import { EventService } from '../../../apps/server/dist/event/service.js';
import { EventStore } from '../../../apps/server/dist/event/store.js';
import { MessageService } from '../../../apps/server/dist/message/service.js';
import { RunCancellationCoordinator } from '../../../apps/server/dist/run/cancellation.js';
import { RunService } from '../../../apps/server/dist/run/service.js';
import { RunWorker } from '../../../apps/server/dist/run/worker.js';
import { buildServer } from '../../../apps/server/dist/server.js';
import { SessionService } from '../../../apps/server/dist/session/service.js';
import { SessionTokenService } from '../../../apps/server/dist/session/token.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the browser integration test.');

const root = resolve(import.meta.dirname, '../../..');
const database = createDatabase({ databaseUrl, databasePoolMax: 4 });
const secret = 'x'.repeat(32);
const sessions = new SessionService(database, secret, 900);
const tokens = new SessionTokenService(secret, 900);
const conversations = new ConversationService(database);
const messages = new MessageService(database);
const cancellation = new RunCancellationCoordinator();
const events = new EventService(
  new EventStore(database, { retentionMaxEvents: 100 }),
  new EventBroker({ subscriberBufferSize: 20 }),
);
const runs = new RunService(database, cancellation);
const worker = new RunWorker(
  database,
  events,
  () => new MockConnector({ responseText: 'Browser mock response.', chunks: 3 }),
  { leaseMs: 30_000, maxAttempts: 3 },
  cancellation,
);
const workerAbort = new AbortController();
let workerPromise;
const server = buildServer({
  checkDatabase: async () => database.selectFrom('tenants').select('tenant_id').limit(1).execute(),
  bootstrapAnonymous: async (request, context) => sessions.bootstrapAnonymous(request, context),
  conversationService: conversations,
  messageService: messages,
  eventService: events,
  runService: runs,
  sessionTokens: tokens,
  logger: false,
});

server.get('/', async (_request, reply) => {
  void reply.type('text/html');
  return fixtureHtml();
});
server.get('/client/*', serveTree(resolve(root, 'packages/browser-client/dist'), '/client/'));
server.get('/protocol/*', serveTree(resolve(root, 'packages/protocol/dist'), '/protocol/'));
server.get(
  '/vendor/*',
  serveTree(resolve(root, 'node_modules/@sinclair/typebox/build/esm'), '/vendor/', true),
);

let browser;
try {
  await migrateDatabase(database);
  const tenantId = `tenant-${crypto.randomUUID()}`;
  const siteId = `site-${crypto.randomUUID()}`;
  const siteKey = `key-${crypto.randomUUID()}`;
  await database
    .insertInto('tenants')
    .values({ tenant_id: tenantId, display_name: 'Browser test' })
    .execute();
  await database
    .insertInto('sites')
    .values({
      site_id: siteId,
      tenant_id: tenantId,
      site_key: siteKey,
      display_name: 'Browser test site',
      allowed_origins: '[]',
      agent_ref: 'mock-agent',
    })
    .execute();

  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  await database
    .updateTable('sites')
    .set({ allowed_origins: JSON.stringify([address]) })
    .where('site_id', '=', siteId)
    .execute();
  workerPromise = worker.run(workerAbort.signal, 10);

  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const browserErrors = [];
  for (const page of [first, second]) {
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'request failed';
      if (failure !== 'net::ERR_ABORTED') browserErrors.push(`${request.url()}: ${failure}`);
    });
    await page.goto(`${address}/?siteKey=${encodeURIComponent(siteKey)}`);
    await page
      .waitForFunction(() => typeof window.startChat === 'function', undefined, {
        timeout: 10_000,
      })
      .catch((error) => {
        throw new Error(`Browser fixture failed to load: ${browserErrors.join('; ')}`, {
          cause: error,
        });
      });
    await page.evaluate(() => window.startChat());
  }

  const conversation = await first.evaluate(() => window.createConversation());
  await second.evaluate(
    (conversationId) => window.selectConversation(conversationId),
    conversation.conversationId,
  );
  await first.evaluate(() => window.sendMessage('Hello from a real browser.'));
  await Promise.all(
    [first, second].map((page) =>
      page.waitForFunction(
        () => {
          const state = window.chatState();
          return state.messages.length === 2 && state.messages[1]?.role === 'assistant';
        },
        undefined,
        { timeout: 15_000 },
      ),
    ),
  );

  const firstState = await first.evaluate(() => window.chatState());
  const secondState = await second.evaluate(() => window.chatState());
  assert.deepEqual(
    firstState.messages.map(({ messageId, sequence }) => [messageId, sequence]),
    secondState.messages.map(({ messageId, sequence }) => [messageId, sequence]),
  );
  assert.equal(firstState.messages[1].parts[0].text, 'Browser mock response.');

  const principalId = firstState.session.principal.principalId;
  await first.reload();
  await first.waitForFunction(() => typeof window.startChat === 'function');
  await first.evaluate(() => window.startChat());
  const resumed = await first.evaluate(() => window.chatState());
  assert.equal(resumed.session.principal.principalId, principalId);
  assert.equal(resumed.conversation.conversationId, conversation.conversationId);
  assert.equal(resumed.messages.length, 2);
  const persistedValue = await first.evaluate(() => Object.values(localStorage).join(''));
  assert.equal(persistedValue.includes('eyJ'), false, 'bearer token leaked into localStorage');
  assert.deepEqual(browserErrors, []);
  process.stdout.write(
    'Browser client smoke passed: streaming, multi-tab convergence, and refresh resume.\n',
  );
} finally {
  await browser?.close();
  workerAbort.abort();
  await workerPromise?.catch(() => undefined);
  await server.close();
  await database.destroy().catch(() => undefined);
}

function serveTree(directory, prefix, directoryIndexes = false) {
  return async (request, reply) => {
    let path = request.url.split('?')[0].slice(prefix.length);
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) return reply.code(404).send();
    if (directoryIndexes && !path.endsWith('.mjs')) path = `${path.replace(/\/$/, '')}/index.mjs`;
    const file = resolve(directory, path);
    if (!file.startsWith(`${directory}/`)) return reply.code(404).send();
    try {
      void reply.type('text/javascript; charset=utf-8');
      return await readFile(file);
    } catch {
      return reply.code(404).send();
    }
  };
}

function fixtureHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<script type="importmap">{"imports":{
  "@formation-chat-core/protocol":"/protocol/index.js",
  "@sinclair/typebox":"/vendor/index.mjs",
  "@sinclair/typebox/value":"/vendor/value/index.mjs",
  "@sinclair/typebox/":"/vendor/"
}}</script>
<script type="module">
  import { createChatClient, createHttpChatTransport } from '/client/index.js';
  let client;
  window.startChat = async () => {
    const siteKey = new URL(location.href).searchParams.get('siteKey');
    client = createChatClient({ siteKey, transport: createHttpChatTransport({ baseUrl: location.origin }) });
    await client.start();
  };
  window.createConversation = () => client.createConversation();
  window.selectConversation = (id) => client.selectConversation(id);
  window.sendMessage = (text) => client.sendMessage({ parts: [{ type: 'text', text }] });
  window.chatState = () => client.getState();
</script>`;
}
