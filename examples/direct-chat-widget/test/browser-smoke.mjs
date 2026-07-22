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
  const widget = page.locator('formation-chat-widget').first();
  assert.equal(await widget.locator('.launcher-agent').count(), 1);
  const launcherGeometry = await widget.locator('.launcher-agent').evaluate((agent) => {
    const svg = agent.querySelector('svg');
    const head = agent.querySelector('.agent-head');
    const face = agent.querySelector('.agent-face');
    const smile = agent.querySelector('.agent-smile');
    if (!svg || !head || !face || !smile) throw new Error('Agent launcher artwork is incomplete.');
    const headBox = head.getBBox();
    const faceBox = face.getBBox();
    const smileBox = smile.getBBox();
    return {
      backgroundAnimation: globalThis.getComputedStyle(agent).animationName,
      robotAnimation: globalThis.getComputedStyle(svg).animationName,
      shellThickness: (headBox.width - faceBox.width) / 2,
      smileClearance: faceBox.y + faceBox.height - (smileBox.y + smileBox.height),
    };
  });
  assert.equal(launcherGeometry.backgroundAnimation, 'none');
  assert.equal(launcherGeometry.robotAnimation, 'agent-float');
  assert.ok(launcherGeometry.shellThickness <= 5);
  assert.ok(launcherGeometry.smileClearance >= 2);
  const launcher = widget.locator('.launcher');
  const tooltip = widget.locator('.launcher-tooltip');
  assert.equal(await tooltip.textContent(), "Ceci n'est pas une bot. ☝");
  assert.equal(
    await launcher.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
    await widget
      .locator('.launcher-agent')
      .evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
  );
  await launcher.hover();
  await page.waitForTimeout(200);
  assert.equal(
    await tooltip.evaluate((element) => globalThis.getComputedStyle(element).opacity),
    '1',
  );
  const launcherBox = await launcher.boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  if (!launcherBox || !tooltipBox) throw new Error('Launcher tooltip geometry is unavailable.');
  assert.ok(tooltipBox.x + tooltipBox.width < launcherBox.x);
  await page.screenshot({
    path: join(tmpdir(), 'formation-direct-widget-tooltip.png'),
    fullPage: true,
  });

  await page.evaluate(() => {
    const launchers = globalThis.document.createElement('div');
    launchers.id = 'custom-launcher-fixtures';
    launchers.innerHTML = `
      <formation-chat-widget launcher-type="button" launcher-text="Ask us" launcher-tooltip="Custom prompt"></formation-chat-widget>
      <formation-chat-widget launcher-image="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></formation-chat-widget>`;
    globalThis.document.body.append(launchers);
  });
  const textLauncher = page.locator('formation-chat-widget[launcher-type="button"]');
  const imageLauncher = page.locator('formation-chat-widget[launcher-image]');
  assert.equal(await textLauncher.locator('.launcher-text').textContent(), 'Ask us');
  assert.equal(await textLauncher.locator('.launcher-tooltip').textContent(), 'Custom prompt');
  assert.equal(await imageLauncher.locator('.launcher-image').count(), 1);
  await page.locator('#custom-launcher-fixtures').evaluate((element) => element.remove());

  await page.getByRole('button', { name: 'Open chat' }).click();
  const panelBox = await widget.locator('.panel').boundingBox();
  const openLauncherBox = await launcher.boundingBox();
  if (!panelBox || !openLauncherBox) throw new Error('Open widget geometry is unavailable.');
  assert.ok(panelBox.y + panelBox.height + 8 <= openLauncherBox.y);
  const clearButton = widget.locator('.clear');
  const closeButton = widget.locator('.close');
  const clearFontSize = Number.parseFloat(
    await clearButton.evaluate((element) => globalThis.getComputedStyle(element).fontSize),
  );
  const closeFontSize = Number.parseFloat(
    await closeButton.evaluate((element) => globalThis.getComputedStyle(element).fontSize),
  );
  assert.ok(closeFontSize > clearFontSize);
  const clearBackground = await clearButton.evaluate(
    (element) => globalThis.getComputedStyle(element).backgroundColor,
  );
  await clearButton.hover();
  await page.waitForTimeout(200);
  assert.notEqual(
    await clearButton.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
    clearBackground,
  );
  await closeButton.hover();
  await page.waitForTimeout(200);
  assert.notEqual(
    await closeButton.evaluate((element) => globalThis.getComputedStyle(element).transform),
    'none',
  );
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
