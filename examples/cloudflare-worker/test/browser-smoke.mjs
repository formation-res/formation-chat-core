/* global Headers, Request, Response, URL, URLSearchParams */

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
const analyticsEvents = [];
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
        outgoing.end(hostPage(url.searchParams));
        return;
      }
      if (url.pathname === '/favicon.ico') {
        outgoing.statusCode = 204;
        outgoing.end();
        return;
      }
      if (url.pathname === '/analytics/collect') {
        analyticsEvents.push({
          body: JSON.parse((await Array.fromAsync(incoming)).join('')),
          origin: incoming.headers.origin,
        });
        outgoing.statusCode = 202;
        outgoing.end();
        return;
      }
      if (url.pathname === '/widget/config' || url.pathname.startsWith('/v1/')) {
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
    HAYSTACK_CONNECTOR_TOKEN: 'browser-smoke-service-token',
    CHAT_SITES: JSON.stringify({
      '127.0.0.1': {
        siteKey: 'trusted-site',
        allowedOrigins: [baseUrl],
        dashboardOrigins: [baseUrl],
        analytics: {
          endpoint: `${baseUrl}/analytics/collect`,
          siteId: 'widget-browser-smoke',
        },
        widget: {
          widgetKey: 'main-chat',
          version: '2026-07-23',
          defaultAgent: 'support',
          theme: 'earth',
          launcher: 'agent',
          placement: 'bottom-right',
          agentAliases: {
            support: {
              siteKey: 'trusted-site',
              label: 'Support',
              emailHandoff: true,
            },
            sales: { siteKey: 'trusted-site', label: 'Sales' },
          },
        },
      },
    }),
  };

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await exerciseAlias(context, 'support', 'Support', { placement: 'bottom-right' });
  await exerciseAlias(context, 'sales', 'Sales', {
    launcher: 'text',
    placement: 'bottom-left',
    theme: 'rgb',
  });
  await verifyThemeArtwork(context);

  const sessionAliases = requests
    .filter(({ path }) => path === '/v1/sessions')
    .map(({ body }) => body.agentAlias)
    .sort();
  assert.equal(sessionAliases.filter((alias) => alias === 'sales').length, 2);
  assert.equal(sessionAliases.filter((alias) => alias === 'support').length, 6);
  assert.ok(
    requests.every(
      ({ body }) =>
        !body?.parts?.some(
          (part) =>
            part.type === 'text' &&
            part.text.includes(
              'Please email a well-formatted copy of this conversation to visitor@example.test.',
            ),
        ),
    ),
    'disabled mail option must not send an agent request',
  );
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
  const analyticsTypes = analyticsEvents.map(({ body }) => body.type);
  assert.equal(analyticsTypes.filter((type) => type === 'chat_conversation_length').length, 2);
  assert.equal(analyticsTypes.filter((type) => type === 'chat_conversation_started').length, 2);
  assert.equal(analyticsTypes.filter((type) => type === 'chat_message_sent').length, 2);
  assert.equal(analyticsTypes.filter((type) => type === 'chat_session_started').length, 8);
  assert.ok(
    analyticsEvents.every(
      ({ body, origin }) =>
        origin === baseUrl &&
        body.site_id === 'widget-browser-smoke' &&
        body.payload.widget_id === 'main-chat' &&
        body.payload.website_id === 'widget-browser-smoke' &&
        body.payload.message_count >= 0 &&
        !JSON.stringify(body.payload).match(/session-|conversation-|handoff-/),
    ),
  );
  process.stdout.write(
    'Shared Worker widget browser smoke passed for support and sales aliases.\n',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

async function exerciseAlias(context, agent, label, options = {}) {
  const page = await context.newPage();
  await page.setViewportSize(
    agent === 'sales' ? { width: 390, height: 844 } : { width: 1024, height: 768 },
  );
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
  const search = new URLSearchParams({ agent, ...options });
  await page.goto(`${baseUrl}/host?${search}`, { waitUntil: 'networkidle' });
  const widget = page.locator('formation-chat-widget').first();
  await widget.waitFor({ state: 'attached' });
  const launcher = widget.locator('button.launcher');
  await launcher.waitFor();
  assert.equal(await widget.locator('.panel').isHidden(), true);
  assert.equal(await widget.locator('.launcher-tooltip').textContent(), 'Start a conversation');
  const hoverBootstrap = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/sessions',
  );
  await launcher.hover();
  await hoverBootstrap;
  assert.equal(await widget.locator('.panel').isHidden(), true);
  await launcher.click();
  assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(await launcher.getAttribute('aria-label'), 'Minimize chat');
  assert.equal(await widget.locator('.back').isVisible(), false);
  assert.equal(await widget.locator('.menu').isVisible(), true);
  assert.equal(await widget.locator('.maximize').isVisible(), true);
  assert.equal(await widget.locator('.maximize').getAttribute('aria-label'), 'Maximize chat');
  const maximizeAlignment = await widget.locator('.maximize').evaluate((button) => {
    const icon = button.querySelector('.maximize-icon');
    if (!(icon instanceof globalThis.HTMLElement)) throw new Error('Maximize icon is missing.');
    const buttonBounds = button.getBoundingClientRect();
    const iconBounds = icon.getBoundingClientRect();
    return {
      x: Math.abs(
        buttonBounds.left + buttonBounds.width / 2 - (iconBounds.left + iconBounds.width / 2),
      ),
      y: Math.abs(
        buttonBounds.top + buttonBounds.height / 2 - (iconBounds.top + iconBounds.height / 2),
      ),
    };
  });
  assert.ok(maximizeAlignment.x < 0.5);
  assert.ok(maximizeAlignment.y < 0.5);
  if (agent === 'support') {
    assert.equal(await launcher.locator('.launcher-image').isVisible(), false);
    assert.equal(await launcher.locator('.launcher-collapse').isVisible(), true);
  }
  await widget.getByText('What can we help you with?').waitFor();
  await widget.getByText(label, { exact: true }).first().waitFor();
  await widget.locator('.menu').click();
  await widget.getByText('More options').waitFor();
  assert.equal(await widget.locator('[data-open-page="mail"]').isDisabled(), true);
  await widget.locator('.back').click();
  assert.equal(await widget.getAttribute('color-mode'), 'light');
  await widget.evaluate((element) => element.setAttribute('color-mode', 'dark'));
  assert.deepEqual(
    await widget.evaluate((element) => {
      const panel = element.shadowRoot?.querySelector('.panel');
      const welcome = element.shadowRoot?.querySelector('.welcome');
      const composer = element.shadowRoot?.querySelector('.composer');
      if (!(panel && welcome && composer))
        throw new Error('Widget color-mode surfaces are missing.');
      const hostStyle = globalThis.getComputedStyle(element);
      return {
        datasetMode: element.dataset.colorMode,
        ink: hostStyle.getPropertyValue('--chat-ink').trim(),
        paper: hostStyle.getPropertyValue('--chat-paper').trim(),
        surface: hostStyle.getPropertyValue('--chat-surface').trim(),
        muted: hostStyle.getPropertyValue('--chat-muted').trim(),
        line: hostStyle.getPropertyValue('--chat-line').trim(),
        accentInk: hostStyle.getPropertyValue('--chat-accent-ink').trim(),
        panel: globalThis.getComputedStyle(panel).backgroundColor,
        welcome: globalThis.getComputedStyle(welcome).backgroundColor,
        composer: globalThis.getComputedStyle(composer).backgroundColor,
      };
    }),
    {
      datasetMode: 'dark',
      ink: '#f5f7f6',
      paper: '#1b241f',
      surface: '#252f29',
      muted: '#bdc8c1',
      line: '#46554c',
      accentInk: '#101713',
      panel: 'rgb(27, 36, 31)',
      welcome: 'rgb(37, 47, 41)',
      composer: 'rgb(37, 47, 41)',
    },
  );
  await widget.evaluate((element) => element.setAttribute('color-mode', 'unknown'));
  assert.equal(await widget.evaluate((element) => element.dataset.colorMode), 'light');
  await widget.evaluate((element) => element.setAttribute('color-mode', 'light'));
  const themeContrastRatios = await widget.evaluate((element) => {
    const relativeLuminance = (hex) => {
      const channels = hex
        .match(/[0-9a-f]{2}/gi)
        .map((channel) => Number.parseInt(channel, 16) / 255)
        .map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        );
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrastRatio = (first, second) => {
      const firstLuminance = relativeLuminance(first);
      const secondLuminance = relativeLuminance(second);
      return (
        (Math.max(firstLuminance, secondLuminance) + 0.05) /
        (Math.min(firstLuminance, secondLuminance) + 0.05)
      );
    };
    return ['hot-pink', 'blue', 'dark-green', 'light', 'rgb-neon'].flatMap((theme) => {
      element.setAttribute('theme', theme);
      return ['light', 'dark'].map((colorMode) => {
        element.setAttribute('color-mode', colorMode);
        const style = globalThis.getComputedStyle(element);
        return {
          theme,
          colorMode,
          ratio: contrastRatio(
            style.getPropertyValue('--chat-paper').trim(),
            style.getPropertyValue('--chat-accent-strong').trim(),
          ),
        };
      });
    });
  });
  assert.ok(
    themeContrastRatios.every(({ ratio }) => ratio >= 4.5),
    `Theme accent contrast fell below 4.5:1: ${JSON.stringify(themeContrastRatios)}`,
  );
  await widget.evaluate((element, originalTheme) => {
    element.setAttribute('theme', originalTheme);
    element.setAttribute('color-mode', 'light');
  }, options.theme ?? 'hot-pink');
  assert.equal(
    await widget
      .locator('.agent-sprite')
      .evaluateAll(
        (avatars) => avatars.filter((avatar) => avatar.getClientRects().length > 0).length,
      ),
    2,
  );
  const headerAlignment = await widget.locator('.panel > header').evaluate((header) => {
    const actions = header.querySelector('.header-actions');
    if (!(actions instanceof globalThis.HTMLElement))
      throw new Error('Header actions are missing.');
    return {
      actionsRight: actions.getBoundingClientRect().right,
      headerRight: header.getBoundingClientRect().right,
    };
  });
  assert.ok(headerAlignment.headerRight - headerAlignment.actionsRight <= 12);
  assert.deepEqual(
    await widget.locator('.send').evaluate((button) => {
      const style = globalThis.getComputedStyle(button);
      return { backgroundColor: style.backgroundColor, color: style.color };
    }),
    { backgroundColor: 'rgb(255, 117, 173)', color: 'rgb(27, 33, 30)' },
  );
  let agentAvatarIndex = Number(
    await widget.locator('.header-avatar').getAttribute('data-agent-avatar-index'),
  );
  let userAvatarIndex = Number(
    await page.evaluate(
      (key) => globalThis.localStorage.getItem(key),
      `formation-chat-widget:main-chat:${agent}:user-avatar`,
    ),
  );
  assert.ok(Number.isInteger(agentAvatarIndex) && agentAvatarIndex >= 0 && agentAvatarIndex < 36);
  assert.ok(Number.isInteger(userAvatarIndex) && userAvatarIndex >= 0 && userAvatarIndex < 108);
  const avatarStyle = await widget.locator('.header-avatar').evaluate((avatar) => {
    const style = globalThis.getComputedStyle(avatar);
    return {
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      overflow: style.overflow,
    };
  });
  assert.ok(
    avatarStyle.backgroundImage.includes('formation-agent-sprite-v2.webp'),
    'legacy earth and rgb themes should use the hot-pink default agent sprite',
  );
  assert.equal(avatarStyle.backgroundSize, '720% 720%');
  assert.equal(avatarStyle.overflow, 'hidden');
  assert.deepEqual(
    await widget
      .locator('.agent-sprite')
      .evaluateAll((avatars) =>
        avatars.map((avatar) => Number(avatar.getAttribute('data-agent-avatar-index'))),
      ),
    Array(await widget.locator('.agent-sprite').count()).fill(agentAvatarIndex),
  );
  assert.equal(
    await page.evaluate(
      (key) => globalThis.localStorage.getItem(key),
      `formation-chat-widget:main-chat:${agent}:agent-avatar`,
    ),
    String(agentAvatarIndex),
  );
  await widget
    .locator('.panel')
    .evaluate((panel) => Promise.all(panel.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-welcome.png`),
    fullPage: true,
  });
  const welcomeAboutMetrics = await widget.locator('.welcome-about').evaluate((button) => {
    const card = button.closest('.welcome');
    if (!(card instanceof globalThis.HTMLElement)) throw new Error('Welcome card is missing.');
    const message = card.querySelector('p');
    if (!(message instanceof globalThis.HTMLElement))
      throw new Error('Welcome message is missing.');
    const buttonBounds = button.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    return {
      bottomGap: cardBounds.bottom - buttonBounds.bottom,
      fontSize: Number.parseFloat(globalThis.getComputedStyle(button).fontSize),
      messageFontSize: Number.parseFloat(globalThis.getComputedStyle(message).fontSize),
      rightGap: cardBounds.right - buttonBounds.right,
      svgCount: button.querySelectorAll('svg').length,
    };
  });
  assert.ok(welcomeAboutMetrics.bottomGap <= 12);
  assert.ok(welcomeAboutMetrics.rightGap <= 12);
  assert.ok(welcomeAboutMetrics.fontSize >= 9.5);
  assert.ok(welcomeAboutMetrics.fontSize < welcomeAboutMetrics.messageFontSize);
  assert.equal(welcomeAboutMetrics.svgCount, 1);
  const replacementAgentIndex = (agentAvatarIndex + 1) % 36;
  await widget.locator('.welcome-avatar').click();
  await widget.getByText('Choose an agent avatar').waitFor();
  assert.equal(
    await widget
      .locator('.avatar-choice')
      .evaluateAll(
        (choices) => choices.filter((choice) => choice.getClientRects().length > 0).length,
      ),
    36,
  );
  await widget
    .locator('[data-page="avatar"]')
    .evaluate((page) => Promise.all(page.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-agent-gallery.png`),
    fullPage: true,
  });
  await widget.locator(`[data-avatar-choice="${replacementAgentIndex}"]`).click();
  await widget.getByText('What can we help you with?').waitFor();
  agentAvatarIndex = replacementAgentIndex;
  assert.equal(
    Number(await widget.locator('.header-avatar').getAttribute('data-agent-avatar-index')),
    agentAvatarIndex,
  );
  await widget.locator('.welcome-about').click();
  await widget.getByText('How your agent works').waitFor();
  await widget.locator('.back').click();
  await widget.getByText('More options').waitFor();
  await widget.locator('.back').click();
  await widget.getByText('What can we help you with?').waitFor();
  await widget.locator('.emoji-toggle').click();
  assert.ok((await widget.locator('[data-emoji]').count()) >= 24);
  await widget.locator('.header-copy').click();
  assert.equal(await widget.locator('.emoji-board').isHidden(), true);
  assert.equal(await widget.locator('.emoji-toggle').getAttribute('aria-expanded'), 'false');
  await widget.locator('.emoji-toggle').click();
  await widget.locator('[data-emoji="👋"]').click();
  assert.equal(await widget.locator('textarea').inputValue(), '👋');
  await widget.locator('textarea').fill(`Hello from ${agent}`);
  await widget.locator('textarea').press('Enter');
  await widget.getByText(`Hello from ${agent}`).waitFor();
  await widget.getByText('Hello from the shared gateway.').waitFor();
  const markdownMessage = widget.locator('.message-row.assistant .message').last();
  assert.equal(await markdownMessage.locator('h2').textContent(), 'Shared answer');
  assert.equal(await markdownMessage.locator('strong').textContent(), 'shared gateway');
  assert.equal(await markdownMessage.locator('li').count(), 2);
  assert.equal(await markdownMessage.locator('a').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await markdownMessage.locator('script').count(), 0);
  assert.match(await markdownMessage.textContent(), /<script>alert\(1\)<\/script>/);
  assert.equal(await widget.locator('.welcome').count(), 1);
  assert.equal(
    await widget.locator('.messages').locator(':scope > article').first().getAttribute('class'),
    'welcome',
  );
  assert.equal(await widget.locator('.message-avatar').count(), 2);
  assert.equal(await widget.locator('.message-avatar.user-sprite').count(), 1);
  assert.ok(
    (
      await widget
        .locator('.message-avatar.user-sprite')
        .evaluate((avatar) => globalThis.getComputedStyle(avatar).backgroundImage)
    ).match(/formation-user-(?:sprite|sprite-alt|animal-sprite)\.webp/),
  );
  const replacementUserIndex = (userAvatarIndex + 1) % 108;
  await widget.locator('.message-avatar.user-sprite').click();
  await widget.getByText('Choose your avatar').waitFor();
  assert.equal(await widget.locator('.avatar-choice').count(), 108);
  assert.equal(await widget.locator('[data-avatar-section="human"]').count(), 1);
  assert.equal(await widget.locator('[data-avatar-section="animals"]').count(), 1);
  assert.equal(await widget.getByText('Human', { exact: true }).count(), 1);
  assert.equal(await widget.getByText('More people', { exact: true }).count(), 0);
  await widget
    .locator('[data-page="avatar"]')
    .evaluate((page) => Promise.all(page.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-user-gallery.png`),
    fullPage: true,
  });
  await widget.locator(`[data-avatar-choice="${replacementUserIndex}"]`).click();
  await widget.getByText(`Hello from ${agent}`).waitFor();
  userAvatarIndex = replacementUserIndex;
  assert.equal(
    Number(
      await widget.locator('.message-avatar.user-sprite').getAttribute('data-user-avatar-index'),
    ),
    userAvatarIndex,
  );
  assert.equal(await widget.locator('.message-meta time').count(), 2);
  assert.equal(await widget.locator('.message-copy').count(), 2);
  const copyButton = widget.locator('.message-copy').first();
  await copyButton.click();
  await copyButton.evaluate(
    (button) =>
      new Promise((resolve, reject) => {
        if (button.getAttribute('aria-label') === 'Copied') return resolve();
        const observer = new globalThis.MutationObserver(() => {
          if (button.getAttribute('aria-label') !== 'Copied') return;
          observer.disconnect();
          resolve();
        });
        observer.observe(button, { attributes: true, attributeFilter: ['aria-label'] });
        globalThis.setTimeout(() => {
          observer.disconnect();
          reject(new Error('Copy confirmation was not shown.'));
        }, 1000);
      }),
  );
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-chat.png`),
    fullPage: true,
  });

  await widget.locator('.menu').click();
  await widget.getByText('More options').waitFor();
  const popupPromise = page.waitForEvent('popup');
  await widget.getByText('Print conversation', { exact: true }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState();
  assert.match(await printPage.title(), new RegExp(`Conversation with ${label}`));
  assert.match(await printPage.locator('body').innerText(), /Widget host|127\.0\.0\.1/);
  assert.equal(await printPage.locator('header .print-avatar img').count(), 1);
  assert.equal(await printPage.locator('article .print-avatar img').count(), 2);
  assert.equal(
    Number(await printPage.locator('header .print-avatar').getAttribute('data-avatar-index')),
    agentAvatarIndex,
  );
  assert.equal(
    Number(await printPage.locator('article.user .print-avatar').getAttribute('data-avatar-index')),
    userAvatarIndex,
  );
  await printPage.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-print.png`),
    fullPage: true,
  });
  await printPage.close();

  await widget.getByText('About this chat', { exact: true }).click();
  await widget.getByText('How your agent works').waitFor();
  assert.equal(await widget.locator('.about-privacy a').getAttribute('href'), `${baseUrl}/privacy`);
  const flowArtwork = widget.locator('.artwork-frame img');
  await flowArtwork.waitFor();
  assert.ok((await flowArtwork.evaluate((image) => image.naturalWidth)) >= 1600);
  assert.match(await flowArtwork.getAttribute('src'), /agent-flow-diagram-hot-pink\.webp$/);
  assert.equal(
    await widget
      .locator('.artwork-card')
      .evaluate((card) => globalThis.getComputedStyle(card).borderTopWidth),
    '0px',
  );
  assert.equal(await widget.locator('.artwork-card > strong').count(), 0);
  const aboutComposition = await widget.locator('.about-page').evaluate((about) => {
    const explanation = about.querySelector('.about-explanation');
    const artworkFrame = about.querySelector('.artwork-frame');
    const privacyNotice = about.querySelector('.about-privacy');
    if (!(explanation && artworkFrame && privacyNotice))
      throw new Error('About composition is incomplete.');
    const aboutBounds = about.getBoundingClientRect();
    const privacyBounds = privacyNotice.getBoundingClientRect();
    return {
      explanationFontSize: Number.parseFloat(globalThis.getComputedStyle(explanation).fontSize),
      artworkRadius: Number.parseFloat(globalThis.getComputedStyle(artworkFrame).borderRadius),
      privacyBottomGap: aboutBounds.bottom - privacyBounds.bottom,
    };
  });
  assert.ok(aboutComposition.explanationFontSize >= 14);
  assert.ok(aboutComposition.artworkRadius >= 10);
  assert.ok(aboutComposition.privacyBottomGap >= 15);
  assert.ok(aboutComposition.privacyBottomGap <= 24);
  assert.ok(
    await widget.locator('.about-page').evaluate((about) => {
      const artwork = about.querySelector('.artwork-card');
      const privacyNotice = about.querySelector('.about-privacy');
      return Boolean(
        artwork &&
        privacyNotice &&
        artwork.compareDocumentPosition(privacyNotice) &
          globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  );
  await widget
    .locator('[data-page="about"]')
    .evaluate((page) => Promise.all(page.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-about.png`),
    fullPage: true,
  });
  const artwork = widget.locator('.artwork-card');
  const compactPanelGeometry = await widget.locator('.panel').evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  });
  if ((await page.viewportSize()).width >= 600) {
    assert.ok(compactPanelGeometry.height <= 561);
  }
  await artwork.click();
  assert.equal(await artwork.getAttribute('aria-expanded'), 'true');
  assert.equal(await widget.locator('.maximize').getAttribute('aria-label'), 'Restore chat size');
  assert.equal(await widget.locator('.panel').getAttribute('class'), 'panel is-maximized');
  await widget
    .locator('.panel')
    .evaluate((panel) => Promise.all(panel.getAnimations().map((animation) => animation.finished)));
  const expandedGeometry = await widget.locator('.panel').evaluate((panel) => {
    const panelBounds = panel.getBoundingClientRect();
    return {
      panelWidth: panelBounds.width,
      left: panelBounds.left,
      right: panelBounds.right,
      top: panelBounds.top,
      bottom: panelBounds.bottom,
      viewportHeight: globalThis.innerHeight,
      viewportWidth: globalThis.innerWidth,
    };
  });
  if (expandedGeometry.viewportWidth >= 600) {
    assert.ok(expandedGeometry.panelWidth > compactPanelGeometry.width * 1.5);
    assert.ok(expandedGeometry.bottom - expandedGeometry.top <= 710);
    assert.ok(expandedGeometry.left >= 8);
    assert.ok(expandedGeometry.top >= 8);
    assert.ok(expandedGeometry.right <= expandedGeometry.viewportWidth - 8);
    assert.ok(expandedGeometry.bottom <= expandedGeometry.viewportHeight - 8);
  } else {
    assert.ok(expandedGeometry.left >= -1);
    assert.ok(expandedGeometry.top >= -1);
    assert.ok(expandedGeometry.right <= expandedGeometry.viewportWidth + 1);
    assert.ok(expandedGeometry.bottom <= expandedGeometry.viewportHeight + 1);
  }
  assert.ok(
    await widget
      .locator('[data-page="about"]')
      .evaluate((about) => about.scrollHeight <= about.clientHeight + 1),
  );
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-flow-expanded.png`),
    fullPage: true,
  });
  await artwork.click();
  assert.equal(await artwork.getAttribute('aria-expanded'), 'false');
  assert.equal(await widget.locator('.panel').getAttribute('class'), 'panel');
  await artwork.click();
  assert.equal(await widget.locator('.panel').getAttribute('class'), 'panel is-maximized');
  await widget.locator('.back').click();
  await widget.getByText('More options').waitFor();
  await widget.locator('.back').click();
  await widget.getByText(`Hello from ${agent}`).waitFor();
  assert.equal(await widget.locator('.panel').getAttribute('class'), 'panel is-maximized');
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}-chat-maximized.png`),
    fullPage: true,
  });
  await widget.locator('.close').click();
  await widget.locator('.panel').waitFor({ state: 'hidden' });
  assert.equal(await widget.locator('.panel').getAttribute('class'), 'panel');
  assert.equal(await widget.locator('.maximize').getAttribute('aria-label'), 'Maximize chat');
  assert.equal(await widget.locator('.maximize').getAttribute('aria-pressed'), 'false');
  await widget.locator('.launcher').click();
  await widget.locator('.panel').waitFor({ state: 'visible' });
  assert.equal(await widget.locator('.panel').getAttribute('class'), 'panel');
  await widget.locator('.menu').click();
  await widget.getByText('More options').waitFor();
  const mailOption = widget.locator('[data-open-page="mail"]');
  assert.equal(await mailOption.isDisabled(), agent !== 'support');
  assert.equal(await widget.locator('[data-page="mail"]').isHidden(), true);
  if (agent === 'support') {
    await mailOption.click();
    assert.equal(await widget.locator('[data-page="mail"]').isVisible(), true);
    await widget.locator('.back').click();
  }
  await widget.locator('.back').click();
  await page.screenshot({
    path: join(tmpdir(), `formation-worker-widget-${agent}.png`),
    fullPage: true,
  });
  assert.deepEqual(problems, []);
  await page.mouse.move(0, 0);
  await page.reload({ waitUntil: 'networkidle' });
  const reloadedWidget = page.locator('formation-chat-widget').first();
  await reloadedWidget.waitFor({ state: 'attached' });
  assert.equal(
    Number(
      await reloadedWidget.locator('.agent-sprite').first().getAttribute('data-agent-avatar-index'),
    ),
    agentAvatarIndex,
  );
  assert.equal(
    Number(
      await page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        `formation-chat-widget:main-chat:${agent}:user-avatar`,
      ),
    ),
    userAvatarIndex,
  );
  assert.equal(await reloadedWidget.locator('.panel').isHidden(), true);
  const restoredMessages = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.endsWith('/messages'),
  );
  await reloadedWidget.locator('button.launcher').hover();
  await restoredMessages;
  await reloadedWidget.getByText('Continue your conversation', { exact: true }).waitFor();
  assert.equal(await reloadedWidget.locator('.panel').isHidden(), true);
  await page.close();
}

async function verifyThemeArtwork(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const theme of ['blue', 'dark-green', 'light', 'rgb-neon']) {
    await page.goto(`${baseUrl}/host?agent=support&theme=${theme}`, { waitUntil: 'networkidle' });
    const widget = page.locator('formation-chat-widget').first();
    await widget.locator('button.launcher').click();
    await widget.getByText('What can we help you with?').waitFor();
    await widget.locator('.menu').click();
    await widget.getByText('About this chat', { exact: true }).click();
    const artwork = widget.locator('.artwork-frame img');
    await artwork.waitFor();
    assert.match(
      await artwork.getAttribute('src'),
      new RegExp(`agent-flow-diagram-${theme}\\.webp$`),
    );
    assert.match(
      await widget
        .locator('.header-avatar')
        .evaluate((avatar) => globalThis.getComputedStyle(avatar).backgroundImage),
      new RegExp(`formation-agent-sprite-${theme}\\.webp`),
    );
    await widget
      .locator('[data-page="about"]')
      .evaluate((about) =>
        Promise.all(about.getAnimations().map((animation) => animation.finished)),
      );
  }
  await page.screenshot({
    path: join(tmpdir(), 'formation-worker-widget-themed-artwork.png'),
    fullPage: true,
  });
  await page.close();
}

function hostPage(searchParams) {
  const agent = searchParams.get('agent') ?? 'support';
  const launcher = searchParams.get('launcher') ?? searchParam(agent, 'launcher');
  const placement = searchParams.get('placement') ?? searchParam(agent, 'placement');
  const theme = searchParams.get('theme') ?? searchParam(agent, 'theme');
  const colorMode = searchParams.get('colorMode') ?? 'light';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Widget host</title>
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body>
    <h1>Widget host</h1>
    <script type="module" src="/widget.js" data-widget-key="main-chat" data-agent="${agent}" data-theme="${theme}" data-color-mode="${colorMode}" data-launcher="${launcher}" data-placement="${placement}" data-privacy-policy-url="${baseUrl}/privacy" async></script>
  </body>
</html>`;
}

function searchParam(agent, name) {
  if (agent !== 'sales') {
    if (name === 'theme') return 'earth';
    if (name === 'launcher') return 'agent';
    if (name === 'placement') return 'bottom-right';
  }
  if (name === 'theme') return 'dark';
  if (name === 'launcher') return 'text';
  return 'bottom-left';
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
  if (extension === '.webp') return 'image/webp';
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
      expiresAt: '2030-07-23T12:30:00.000Z',
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
    const submittedMessage = requests.findLast(
      ({ method, path }) =>
        method === 'POST' && path === `/v1/conversations/${conversation.conversationId}/messages`,
    );
    return Response.json({
      data: submittedMessage ? [messageFor(conversation, submittedMessage.body)] : [],
      pagination: { hasMore: false },
    });
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}/messages`) {
    return Response.json(messageFor(conversation, body));
  }
  if (url.pathname === `/v1/conversations/${conversation.conversationId}/events`) {
    return new Response(eventStream(conversation), {
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

function eventStream(conversation) {
  const base = {
    eventId: `event-${conversation.agentRef}`,
    sequence: 1,
    type: 'message.delta',
    occurredAt: '2026-07-23T12:00:02.000Z',
    visibility: 'public',
    conversationId: conversation.conversationId,
    runId: `run-${conversation.agentRef}`,
    messageId: `assistant-${conversation.agentRef}`,
    data: {
      delta:
        '## Shared answer\n\n- Hello from the **shared gateway**.\n- Read [the guide](https://example.com/help)\n\n<script>alert(1)</script>',
    },
  };
  return `id: ${base.eventId}\nevent: ${base.type}\ndata: ${JSON.stringify(base)}\n\n`;
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
