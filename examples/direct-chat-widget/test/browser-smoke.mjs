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
  const tooltipArtworkFrame = tooltip.locator('.launcher-tooltip-artwork-frame');
  const tooltipArtwork = tooltip.locator('.launcher-tooltip-artwork');
  assert.equal(
    await tooltip.locator('.launcher-tooltip-title').textContent(),
    "\"Ceci n'est pas une chatbot.\"",
  );
  assert.equal(
    await tooltip.locator('.launcher-tooltip-credit').textContent(),
    'Artwork - in respectful admiration, inspired by René Magritte',
  );
  assert.equal(await tooltip.locator('.launcher-tooltip-copy .launcher-tooltip-credit').count(), 0);
  assert.equal(await tooltip.locator('.launcher-tooltip-copy > *').count(), 1);
  const tooltipArtworkSource = await tooltipArtwork.evaluate((image) => ({
    complete: image.complete,
    naturalHeight: image.naturalHeight,
    naturalWidth: image.naturalWidth,
  }));
  assert.deepEqual(tooltipArtworkSource, {
    complete: true,
    naturalHeight: 740,
    naturalWidth: 1110,
  });
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
  const tooltipCopyBox = await tooltip.locator('.launcher-tooltip-copy').boundingBox();
  if (!launcherBox || !tooltipBox || !tooltipCopyBox) {
    throw new Error('Launcher tooltip geometry is unavailable.');
  }
  const initialHorizontalGap = launcherBox.x - (tooltipBox.x + tooltipBox.width);
  const initialTooltipRight = tooltipBox.x + tooltipBox.width;
  const initialTooltipBottom = tooltipBox.y + tooltipBox.height;
  assert.ok(initialHorizontalGap >= 8 && initialHorizontalGap <= 16);
  assert.ok(tooltipBox.width <= 240);
  assert.ok(tooltipBox.y >= 0);
  assert.ok(tooltipBox.y + tooltipBox.height <= 800);
  assert.ok(tooltipCopyBox.y + tooltipCopyBox.height <= 800);
  const tooltipStyles = await tooltip.evaluate((element) => {
    const styles = globalThis.getComputedStyle(element);
    return { gap: styles.gap, overflow: styles.overflow };
  });
  assert.deepEqual(tooltipStyles, { gap: '0px', overflow: 'hidden' });
  const artworkBox = await tooltipArtwork.boundingBox();
  const artworkFrameBox = await tooltipArtworkFrame.boundingBox();
  const creditBox = await tooltip.locator('.launcher-tooltip-credit').boundingBox();
  if (!artworkBox || !artworkFrameBox || !creditBox) {
    throw new Error('Tooltip artwork geometry is unavailable.');
  }
  assert.ok(Math.abs(artworkBox.y + artworkBox.height - tooltipCopyBox.y) <= 0.5);
  assert.ok(creditBox.x >= artworkFrameBox.x);
  assert.ok(creditBox.y >= artworkFrameBox.y);
  assert.ok(creditBox.x + creditBox.width <= artworkFrameBox.x + artworkFrameBox.width);
  assert.ok(creditBox.y + creditBox.height <= artworkFrameBox.y + artworkFrameBox.height);
  assert.deepEqual(
    await tooltip.locator('.launcher-tooltip-copy').evaluate((element) => {
      const styles = globalThis.getComputedStyle(element);
      return {
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        color: styles.color,
        paddingBottom: Number.parseFloat(styles.paddingBottom),
        paddingTop: Number.parseFloat(styles.paddingTop),
      };
    }),
    {
      backgroundColor: 'rgb(239, 225, 187)',
      backgroundImage: 'none',
      color: 'rgb(64, 53, 34)',
      paddingBottom: 10.88,
      paddingTop: 11.52,
    },
  );
  assert.equal(
    await tooltip
      .locator('.launcher-tooltip-title')
      .evaluate((element) => globalThis.getComputedStyle(element).textAlign),
    'center',
  );
  const titleFontSize = Number.parseFloat(
    await tooltip
      .locator('.launcher-tooltip-title')
      .evaluate((element) => globalThis.getComputedStyle(element).fontSize),
  );
  const creditStyles = await tooltip.locator('.launcher-tooltip-credit').evaluate((element) => {
    const styles = globalThis.getComputedStyle(element);
    return {
      fitsOneLine: element.scrollWidth <= element.clientWidth,
      fontSize: Number.parseFloat(styles.fontSize),
      textAlign: styles.textAlign,
      whiteSpace: styles.whiteSpace,
    };
  });
  assert.ok(creditStyles.fontSize < titleFontSize);
  assert.ok(creditStyles.fontSize <= 7.2);
  assert.equal(creditStyles.textAlign, 'right');
  assert.equal(creditStyles.whiteSpace, 'nowrap');
  assert.equal(creditStyles.fitsOneLine, true);
  const expandArtworkButton = tooltip.locator('.launcher-tooltip-expand');
  assert.equal(await expandArtworkButton.count(), 1);
  assert.equal(await expandArtworkButton.getAttribute('aria-label'), 'Enlarge artwork');
  await tooltip.hover();
  await page.waitForTimeout(200);
  assert.equal(
    await tooltip.evaluate((element) => globalThis.getComputedStyle(element).opacity),
    '1',
  );
  assert.equal(
    await expandArtworkButton.evaluate((element) => globalThis.getComputedStyle(element).opacity),
    '1',
  );
  await expandArtworkButton.hover();
  assert.equal(
    await expandArtworkButton.evaluate(
      (element) => globalThis.getComputedStyle(element).backgroundColor,
    ),
    'rgba(0, 0, 0, 0)',
  );
  const expandButtonBox = await expandArtworkButton.boundingBox();
  if (!expandButtonBox) throw new Error('Artwork expand control geometry is unavailable.');
  assert.ok(expandButtonBox.x >= artworkFrameBox.x);
  assert.ok(expandButtonBox.y >= artworkFrameBox.y);
  assert.ok(expandButtonBox.x + expandButtonBox.width <= artworkFrameBox.x + artworkFrameBox.width);
  assert.ok(
    expandButtonBox.y + expandButtonBox.height <= artworkFrameBox.y + artworkFrameBox.height,
  );
  const initialTooltipWidth = tooltipBox.width;
  const initialArtworkWidth = artworkBox.width;
  await tooltipArtwork.click();
  await page.waitForTimeout(350);
  const expandedTooltipBox = await tooltip.boundingBox();
  const expandedArtworkBox = await tooltipArtwork.boundingBox();
  if (!expandedTooltipBox || !expandedArtworkBox) {
    throw new Error('Expanded tooltip geometry is unavailable.');
  }
  assert.equal(await expandArtworkButton.getAttribute('aria-expanded'), 'true');
  assert.equal(await expandArtworkButton.getAttribute('aria-label'), 'Reduce artwork');
  assert.ok(expandedTooltipBox.width > initialTooltipWidth * 1.8);
  assert.ok(expandedArtworkBox.width > initialArtworkWidth * 1.8);
  assert.ok(tooltipArtworkSource.naturalWidth >= expandedArtworkBox.width * 2);
  assert.ok(expandedTooltipBox.x < tooltipBox.x);
  assert.ok(expandedTooltipBox.y < tooltipBox.y);
  assert.ok(Math.abs(expandedTooltipBox.x + expandedTooltipBox.width - initialTooltipRight) <= 1);
  assert.ok(Math.abs(expandedTooltipBox.y + expandedTooltipBox.height - initialTooltipBottom) <= 1);
  assert.ok(
    Math.abs(
      launcherBox.x - (expandedTooltipBox.x + expandedTooltipBox.width) - initialHorizontalGap,
    ) <= 1,
  );
  assert.ok(
    Number.parseFloat(
      await tooltip
        .locator('.launcher-tooltip-title')
        .evaluate((element) => globalThis.getComputedStyle(element).fontSize),
    ) > titleFontSize,
  );
  assert.equal(await widget.locator('.panel').getAttribute('hidden'), '');
  await page.screenshot({
    path: join(tmpdir(), 'formation-direct-widget-tooltip-expanded.png'),
    fullPage: true,
  });
  await tooltip.locator('.launcher-tooltip-copy').click();
  await page.waitForTimeout(350);
  assert.equal(await expandArtworkButton.getAttribute('aria-expanded'), 'false');
  assert.equal(await expandArtworkButton.getAttribute('aria-label'), 'Enlarge artwork');
  assert.ok(Math.abs((await tooltip.boundingBox()).width - initialTooltipWidth) <= 1);
  await launcher.hover();
  await page.waitForTimeout(200);
  await tooltip.hover();
  await page.mouse.move(100, 700);
  await page.waitForTimeout(200);
  assert.equal(
    await tooltip.evaluate((element) => globalThis.getComputedStyle(element).opacity),
    '0',
  );
  await launcher.hover();
  await page.waitForTimeout(200);
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
  assert.equal(
    await textLauncher.locator('.launcher-tooltip-title').textContent(),
    'Custom prompt',
  );
  const textLauncherRadius = await textLauncher
    .locator('.launcher')
    .evaluate((element) => globalThis.getComputedStyle(element).borderRadius);
  assert.equal(await imageLauncher.locator('.launcher-image').count(), 1);
  await page.locator('#custom-launcher-fixtures').evaluate((element) => element.remove());

  await page.getByRole('button', { name: 'Open chat' }).click();
  const panelBox = await widget.locator('.panel').boundingBox();
  const openLauncherBox = await launcher.boundingBox();
  if (!panelBox || !openLauncherBox) throw new Error('Open widget geometry is unavailable.');
  assert.ok(panelBox.y + panelBox.height + 8 <= openLauncherBox.y);
  const clearButton = widget.locator('.clear');
  const closeButton = widget.locator('.close');
  const closeIcon = closeButton.locator('.close-icon');
  const sendButton = widget.locator('.send');
  assert.equal(await closeIcon.count(), 1);
  const closeBox = await closeButton.boundingBox();
  const closeIconBox = await closeIcon.boundingBox();
  if (!closeBox || !closeIconBox) throw new Error('Close button geometry is unavailable.');
  assert.ok(
    Math.abs(closeBox.x + closeBox.width / 2 - (closeIconBox.x + closeIconBox.width / 2)) <= 0.5,
  );
  assert.ok(
    Math.abs(closeBox.y + closeBox.height / 2 - (closeIconBox.y + closeIconBox.height / 2)) <= 0.5,
  );
  const panelRadius = await widget
    .locator('.panel')
    .evaluate((element) => globalThis.getComputedStyle(element).borderRadius);
  assert.equal(textLauncherRadius, panelRadius);
  for (const button of [clearButton, closeButton, sendButton]) {
    assert.equal(
      await button.evaluate((element) => globalThis.getComputedStyle(element).borderRadius),
      panelRadius,
    );
  }
  assert.equal(
    await sendButton.evaluate((element) => globalThis.getComputedStyle(element).borderWidth),
    '0px',
  );
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
  const closeBackground = await closeButton.evaluate(
    (element) => globalThis.getComputedStyle(element).backgroundColor,
  );
  await closeButton.hover();
  await page.waitForTimeout(200);
  assert.notEqual(
    await closeButton.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
    closeBackground,
  );
  assert.equal(
    await closeButton.evaluate((element) => globalThis.getComputedStyle(element).transform),
    'none',
  );
  const readBackgroundChannels = (element) => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.fillStyle = globalThis.getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const sendBackground = await sendButton.evaluate(readBackgroundChannels);
  await sendButton.hover();
  await page.waitForTimeout(200);
  const sendHoverBackground = await sendButton.evaluate(readBackgroundChannels);
  assert.ok(
    sendHoverBackground.reduce((total, channel) => total + channel, 0) >
      sendBackground.reduce((total, channel) => total + channel, 0),
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
