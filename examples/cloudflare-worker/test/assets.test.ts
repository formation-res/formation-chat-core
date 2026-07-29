import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Cloudflare gateway static assets', () => {
  it('bundles the dashboard shell and shared favicon into Worker assets', async () => {
    const buildScript = await readFile(
      new URL('../scripts/build-site.mjs', import.meta.url),
      'utf8',
    );
    const dashboard = await readFile(new URL('../site/dashboard.html', import.meta.url), 'utf8');

    expect(buildScript).toContain("join(outputDirectory, 'dashboard.html')");
    expect(buildScript).toContain("join(outputDirectory, 'favicon.svg')");
    expect(buildScript).toContain("widget: join(exampleDirectory, 'site/widget.ts')");
    expect(buildScript).toContain(
      "dashboard: join(repositoryDirectory, 'apps/dashboard/src/main.tsx')",
    );
    expect(dashboard).toContain('<div id="root"></div>');
    expect(dashboard).toContain('href="/dashboard.css"');
    expect(dashboard).toContain("img-src 'self' data: https:");
    expect(dashboard).toContain('src="/dashboard.js"');
  });

  it('bundles the redesigned widget and its cross-origin artwork', async () => {
    const source = await readFile(new URL('../site/widget.ts', import.meta.url), 'utf8');
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');
    const buildScript = await readFile(
      new URL('../scripts/build-site.mjs', import.meta.url),
      'utf8',
    );

    expect(source).toContain("new URL('./formation-agent-sprite-v2.webp'");
    expect(source).toContain("new URL('./formation-agent-sprite-blue.webp'");
    expect(source).toContain("new URL('./formation-agent-sprite-dark-green.webp'");
    expect(source).toContain("new URL('./formation-agent-sprite-light.webp'");
    expect(source).toContain("new URL('./formation-agent-sprite-rgb-neon.webp'");
    expect(source).toContain("new URL('./formation-user-sprite.webp'");
    expect(source).toContain("new URL('./formation-user-sprite-alt.webp'");
    expect(source).toContain("new URL('./formation-user-animal-sprite.webp'");
    expect(source).toContain("new URL('./agent-flow-diagram-hot-pink.webp'");
    expect(source).toContain("new URL('./agent-flow-diagram-blue.webp'");
    expect(source).toContain("new URL('./agent-flow-diagram-dark-green.webp'");
    expect(source).toContain("new URL('./agent-flow-diagram-light.webp'");
    expect(source).toContain("new URL('./agent-flow-diagram-rgb-neon.webp'");
    expect(source).toContain('selectStoredConversationAvatars');
    expect(source).toContain('data-avatar-picker="${role}"');
    expect(source).toContain('class="avatar-gallery"');
    expect(source).toContain('data-avatar-section="${section}"');
    expect(source).toContain(
      "avatarSectionMarkup('human', 'Human', 0, USER_AVATARS_PER_SHEET * 2)",
    );
    expect(source).toContain("avatarSectionMarkup('animals'");
    expect(source).toContain('class="maximize"');
    expect(source).toContain('class="emoji-board"');
    expect(source).toContain("document.addEventListener('pointerdown'");
    expect(source).toContain("this.launcher.addEventListener('pointerenter'");
    expect(source).toContain('Continue your conversation');
    expect(source).toContain('clientPromise');
    expect(source).toContain('data-agent-avatar-index');
    expect(source).toContain('data-user-avatar-index');
    expect(source).toContain('createChatClient');
    expect(source).toContain('createWidgetAnalytics');
    expect(source).toContain('void this.ensureClient().catch');
    expect(source).toContain('submitStructuredInput');
    expect(source).toContain('state.contactRequest.prompt');
    expect(source).toContain('Enter your email address to complete the handoff.');
    expect(source).toContain('function isActiveRun');
    expect(source).toContain("url.searchParams.set('widgetKey', config.widgetKey)");
    expect(source).toContain('data-page="about"');
    expect(source).toContain('data-page="mail"');
    expect(source).toContain('Print conversation');
    expect(source).toContain('printAvatarMarkup');
    expect(source).toContain('Mail me this conversation');
    expect(source).toContain('How your agent works');
    expect(source).not.toContain('Magritte');
    expect(source).toContain('navigator.clipboard.writeText');
    expect(source).toContain('class="emoji-board"');
    expect(source).toContain('class="typing-dots"');
    expect(buildScript).toContain("'formation-agent-sprite-v2.webp'");
    expect(buildScript).toContain("'formation-agent-sprite-blue.webp'");
    expect(buildScript).toContain("'formation-agent-sprite-dark-green.webp'");
    expect(buildScript).toContain("'formation-agent-sprite-light.webp'");
    expect(buildScript).toContain("'formation-agent-sprite-rgb-neon.webp'");
    expect(buildScript).toContain("'formation-user-sprite.webp'");
    expect(buildScript).toContain("'formation-user-sprite-alt.webp'");
    expect(buildScript).toContain("'formation-user-animal-sprite.webp'");
    expect(buildScript).toContain("'agent-flow-diagram-hot-pink.webp'");
    expect(buildScript).toContain("'agent-flow-diagram-blue.webp'");
    expect(buildScript).toContain("'agent-flow-diagram-dark-green.webp'");
    expect(buildScript).toContain("'agent-flow-diagram-light.webp'");
    expect(buildScript).toContain("'agent-flow-diagram-rgb-neon.webp'");
    const styles = await readFile(new URL('../site/widget.css', import.meta.url), 'utf8');
    expect(styles).toContain('.message-row.user');
    expect(styles).toContain('.message-avatar');
    expect(styles).toContain('.message-copy');
    expect(styles).toContain('.emoji-board');
    expect(styles).toContain('.typing-dots');
    expect(headers).toMatch(/\/widget\.js[\s\S]*Access-Control-Allow-Origin: \*/);
    expect(headers).toMatch(
      /\/formation-agent-sprite-v2\.webp[\s\S]*Cross-Origin-Resource-Policy: cross-origin/,
    );
    expect(headers).toMatch(
      /\/formation-user-sprite\.webp[\s\S]*Cross-Origin-Resource-Policy: cross-origin/,
    );
    expect(headers).toMatch(
      /\/formation-user-sprite-alt\.webp[\s\S]*Cross-Origin-Resource-Policy: cross-origin/,
    );
    expect(headers).toMatch(
      /\/formation-user-animal-sprite\.webp[\s\S]*Cross-Origin-Resource-Policy: cross-origin/,
    );
    expect(headers).toMatch(
      /\/agent-flow-diagram-hot-pink\.webp[\s\S]*Cross-Origin-Resource-Policy: cross-origin/,
    );
  });

  it('keeps the chat iframe frameable only same-origin while blocking dashboard framing', async () => {
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(headers).toMatch(/\/\*[\s\S]*frame-ancestors 'self'/);
    expect(headers).toMatch(/\/\*[\s\S]*X-Frame-Options: SAMEORIGIN/);
    expect(headers).toMatch(/\/dashboard\.html[\s\S]*frame-ancestors 'none'/);
    expect(headers).toMatch(/\/dashboard\.html[\s\S]*X-Frame-Options: DENY/);
  });

  it('emits dashboard and chat page styles separately from the widget bundle', async () => {
    await execFileAsync(process.execPath, [
      fileURLToPath(new URL('../scripts/build-site.mjs', import.meta.url)),
    ]);

    await expect(stat(new URL('../dist/site/dashboard.css', import.meta.url))).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    );
    await expect(stat(new URL('../dist/site/app.css', import.meta.url))).resolves.toEqual(
      expect.objectContaining({ size: expect.any(Number) }),
    );
    await expect(stat(new URL('../dist/site/widget.css', import.meta.url))).rejects.toThrow();
  });
});
