import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { URL } from 'node:url';

import axe from 'axe-core';
import { chromium } from 'playwright-core';

const baseUrl = process.env.LOCAL_CHAT_BROWSER_URL ?? 'http://127.0.0.1:4173';
const executablePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  const problems = [];
  const apiResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/v1/')) apiResponses.push({ path, status: response.status() });
  });

  await page.addInitScript({ content: axe.source });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(
    await page.getByRole('heading', { name: 'Local integration playground' }).count(),
    1,
  );
  assert.equal(
    await page
      .locator('.local-header')
      .evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
    'rgb(22, 49, 38)',
  );
  await page.getByRole('textbox', { name: 'Message' }).fill('How does this work?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.getByText('This is a deterministic mock response.').waitFor({ timeout: 15_000 });

  const audit = await page.evaluate(async () => globalThis.axe.run());
  assert.deepEqual(
    audit.violations.map(({ id }) => id),
    [],
  );
  assert.deepEqual(problems, []);
  assert.ok(apiResponses.length >= 5, 'Expected session, conversation, message, and SSE requests.');
  assert.ok(apiResponses.every(({ status }) => status >= 200 && status < 300));

  await page.screenshot({ path: join(tmpdir(), 'formation-local-chat-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).count(), 1);
  await page.screenshot({
    path: join(tmpdir(), 'formation-local-chat-narrow.png'),
    fullPage: true,
  });
  process.stdout.write(
    `Local Chat browser smoke passed with ${apiResponses.length} successful API responses.\n`,
  );
} finally {
  await browser.close();
}
