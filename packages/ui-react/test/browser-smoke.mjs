/* global URL, window */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const outputDirectory = await mkdtemp(join(tmpdir(), 'formation-chat-ui-'));
await build({
  entryPoints: [new URL('./fixture.tsx', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  outdir: outputDirectory,
  sourcemap: false,
  logLevel: 'silent',
});

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path === '/') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
      <title>Formation Chat UI</title><link rel="stylesheet" href="/fixture.css"></head>
      <body><main><div id="root"></div></main><script type="module" src="/fixture.js"></script></body></html>`);
    return;
  }
  if (!['/fixture.js', '/fixture.css'].includes(path)) {
    response.statusCode = 404;
    response.end();
    return;
  }
  response.setHeader('content-type', extname(path) === '.css' ? 'text/css' : 'text/javascript');
  response.end(await readFile(join(outputDirectory, path.slice(1))));
});

let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');
  const url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  const browserMessages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      browserMessages.push(message.text());
  });
  page.on('pageerror', (error) => browserMessages.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });

  await page.getByRole('textbox', { name: 'Message' }).fill('How does this work?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.getByText('A clear deterministic response from the mock agent.').waitFor();
  assert.equal(await page.getByRole('status').filter({ hasText: 'Response complete' }).count(), 1);

  const audit = await page.evaluate(() => window.runAccessibilityAudit());
  assert.deepEqual(
    audit.violations.map(({ id }) => id),
    [],
  );
  assert.equal(await page.getByRole('heading', { name: 'Formation assistant' }).count(), 1);
  assert.deepEqual(browserMessages, []);

  await page.screenshot({ path: join(tmpdir(), 'formation-chat-ui-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.screenshot({ path: join(tmpdir(), 'formation-chat-ui-narrow.png'), fullPage: true });

  await page.goto(`${url}/?contact=1`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'Email address' }).fill('visitor@example.com');
  await page.getByRole('button', { name: 'Share email' }).click();
  await page.getByText('Connecting you with our team').waitFor();
  assert.deepEqual(browserMessages, []);
  process.stdout.write(
    'React UI browser smoke passed: keyboard, axe, responsive, and handoff flow.\n',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(outputDirectory, { recursive: true, force: true });
}
