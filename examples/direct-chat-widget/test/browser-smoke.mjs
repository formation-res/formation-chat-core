import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import axe from 'axe-core';
import { chromium } from 'playwright-core';

const baseUrl = process.env.DIRECT_WIDGET_URL ?? 'http://127.0.0.1:8790';
const executablePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  await page.addInitScript({ content: axe.source });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Can I test this today?');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await page.getByText(/This preview is working/).waitFor();

  const audit = await page.evaluate(async () => globalThis.axe.run());
  assert.deepEqual(
    audit.violations.map(({ id }) => id),
    [],
  );
  assert.deepEqual(problems, []);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByText('Can I test this today?', { exact: true }).waitFor();
  await page.getByText(/This preview is working/).waitFor();

  await page.screenshot({
    path: join(tmpdir(), 'formation-direct-widget-wide.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).count(), 1);
  await page.screenshot({
    path: join(tmpdir(), 'formation-direct-widget-narrow.png'),
    fullPage: true,
  });
  process.stdout.write(
    'Direct widget browser smoke passed: chat, accessibility, refresh, and mobile.\n',
  );
} finally {
  await browser.close();
}
