/* global URL */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const directory = new URL('..', import.meta.url).pathname;
const output = join(directory, 'dist');
const axePath = require.resolve('axe-core/axe.min.js');
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/v1/admin/')) {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (request.headers.authorization !== 'Bearer browser-admin-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }));
      return;
    }
    response.end(JSON.stringify(apiResponse(url.pathname)));
    return;
  }
  const file =
    url.pathname === '/'
      ? join(output, 'index.html')
      : url.pathname === '/axe.js'
        ? axePath
        : join(output, url.pathname.slice(1));
  try {
    response.setHeader('content-type', contentType(file));
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:",
    );
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

async function runBrowserSmoke() {
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Dashboard fixture server did not start.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      colorScheme: 'light',
    });
    const browserMessages = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        browserMessages.push(message.text());
    });
    page.on('pageerror', (error) => browserMessages.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('Chat Core URL').fill(baseUrl);
    await page.getByLabel('Admin token').fill('browser-admin-token');
    await page.getByRole('button', { name: 'Open dashboard' }).click();
    await page
      .getByText('Support agent conversation')
      .waitFor({ timeout: 5_000 })
      .catch(async () => {
        throw new Error(
          `Dashboard did not load. Body: ${await page.locator('body').innerText()} Console: ${browserMessages.join(' | ')}`,
        );
      });
    assert.match(
      await page
        .locator('body')
        .evaluate((element) => globalThis.getComputedStyle(element).fontFamily),
      /Inter/,
    );
    await page.getByRole('button', { name: /Support agent conversation/ }).click();
    await page.getByText('How can I change my plan?').waitFor();
    await page.getByRole('tab', { name: /Event timeline/ }).click();
    assert.equal(await page.getByText('Internal diagnostic').count(), 1);
    await page.screenshot({ path: join(tmpdir(), 'chat-core-dashboard-wide.png'), fullPage: true });
    await page.addScriptTag({ url: `${baseUrl}/axe.js` });
    const lightViolations = await accessibilityViolations(page);
    assert.deepEqual(lightViolations, []);

    await page.getByRole('button', { name: 'Runs', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Agent runs' }).waitFor();
    await page.locator('summary').first().click();
    assert.equal(
      await page
        .getByText('External connector trace IDs are not present', { exact: false })
        .count(),
      1,
    );
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.locator('html[data-theme="dark"]').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(tmpdir(), 'chat-core-dashboard-dark.png'), fullPage: true });

    const darkViolations = await accessibilityViolations(page);
    assert.deepEqual(darkViolations, []);
    assert.deepEqual(browserMessages, []);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Conversations', exact: true }).last().click();
    await page.getByRole('button', { name: /Support agent conversation/ }).click();
    await page.getByRole('button', { name: 'Back to conversations' }).waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: join(tmpdir(), 'chat-core-dashboard-mobile.png'),
      fullPage: true,
    });
    assert.equal(
      await page.getByRole('navigation', { name: 'Mobile operations views' }).count(),
      1,
    );
    process.stdout.write(
      'Dashboard browser smoke passed: auth, correlations, desktop, dark mode, mobile, console, and axe.\n',
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function contentType(path) {
  const extension = extname(path);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.map') return 'application/json';
  return 'text/javascript; charset=utf-8';
}

async function accessibilityViolations(page) {
  return page.evaluate(async () =>
    (await globalThis.axe.run(globalThis.document)).violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target.join(' ')),
    })),
  );
}

function apiResponse(path) {
  const pagination = { hasMore: false };
  if (path === '/v1/admin/conversations') return { data: [conversation], pagination };
  if (path === '/v1/admin/conversations/conversation-1') return conversation;
  if (path.endsWith('/messages')) return { data: messages, pagination };
  if (path.endsWith('/events')) return { data: events, pagination };
  if (path === '/v1/admin/runs') return { data: [run], pagination };
  if (path === '/v1/admin/failures')
    return { data: [{ ...run, status: 'failed', errorCode: 'CONNECTOR_TIMEOUT' }], pagination };
  if (path === '/v1/admin/handoffs') return { data: [handoff], pagination };
  return { data: [], pagination };
}

const conversation = {
  conversationId: 'conversation-1',
  tenantId: 'tenant-1',
  siteId: 'formation-web',
  principalId: 'visitor-42',
  agentRef: 'support-agent',
  status: 'active',
  participants: [
    { participantId: 'visitor-1', kind: 'user', principalId: 'visitor-42' },
    { participantId: 'agent-1', kind: 'agent', agentRef: 'support-agent' },
  ],
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:02:00.000Z',
};
const messages = [
  {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    sequence: 1,
    participantId: 'visitor-1',
    role: 'user',
    status: 'completed',
    parts: [{ type: 'text', text: 'How can I change my plan?' }],
    createdAt: '2026-07-16T10:00:00.000Z',
    completedAt: '2026-07-16T10:00:00.000Z',
  },
  {
    messageId: 'message-2',
    conversationId: 'conversation-1',
    sequence: 2,
    participantId: 'agent-1',
    role: 'assistant',
    status: 'completed',
    parts: [
      {
        type: 'text',
        text: 'I can help with that. Your current plan can be changed from account settings.',
      },
      { type: 'tool_status', toolCallId: 'tool-1', label: 'Account lookup', status: 'completed' },
    ],
    createdAt: '2026-07-16T10:00:01.000Z',
    completedAt: '2026-07-16T10:00:03.000Z',
  },
];
const events = [
  {
    eventId: 'event-1',
    sequence: 1,
    type: 'run.started',
    visibility: 'public',
    conversationId: 'conversation-1',
    runId: 'run-1',
    occurredAt: '2026-07-16T10:00:01.000Z',
    data: { agentRef: 'support-agent' },
  },
  {
    eventId: 'event-2',
    sequence: 2,
    type: 'tool.started',
    visibility: 'internal',
    conversationId: 'conversation-1',
    runId: 'run-1',
    messageId: 'message-2',
    occurredAt: '2026-07-16T10:00:02.000Z',
    data: { toolCallId: 'tool-1', label: 'Account lookup' },
  },
];
const run = {
  runId: 'run-1',
  tenantId: 'tenant-1',
  siteId: 'formation-web',
  conversationId: 'conversation-1',
  userMessageId: 'message-1',
  assistantMessageId: 'message-2',
  agentRef: 'support-agent',
  status: 'completed',
  attempt: 1,
  createdAt: '2026-07-16T10:00:01.000Z',
  updatedAt: '2026-07-16T10:00:03.000Z',
  completedAt: '2026-07-16T10:00:03.000Z',
};
const handoff = {
  handoffId: 'handoff-1',
  tenantId: 'tenant-1',
  siteId: 'formation-web',
  conversationId: 'conversation-1',
  runId: 'run-1',
  status: 'awaiting_contact',
  createdAt: '2026-07-16T10:01:30.000Z',
  updatedAt: '2026-07-16T10:01:30.000Z',
};

await runBrowserSmoke();
