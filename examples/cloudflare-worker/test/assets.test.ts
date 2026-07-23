import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

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
    expect(dashboard).toContain('<div id="root"></div>');
    expect(dashboard).toContain('src="/dashboard.js"');
  });

  it('bundles the artwork widget as a static cross-origin script', async () => {
    const source = await readFile(new URL('../site/widget.ts', import.meta.url), 'utf8');
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(source).toContain("this.getAttribute('artwork-key')");
    expect(source).toContain("new URL('./agent-shadow-tooltip-blue.webp'");
    expect(source).toContain('createChatClient');
    expect(source).toContain("url.searchParams.set('widgetKey', config.widgetKey)");
    expect(headers).toMatch(/\/widget\.js[\s\S]*Access-Control-Allow-Origin: \*/);
    expect(headers).toMatch(/\/agent-shadow-tooltip-blue\.webp[\s\S]*Cross-Origin-Resource-Policy: cross-origin/);
  });

  it('keeps the chat iframe frameable only same-origin while blocking dashboard framing', async () => {
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(headers).toMatch(/\/\*[\s\S]*frame-ancestors 'self'/);
    expect(headers).toMatch(/\/\*[\s\S]*X-Frame-Options: SAMEORIGIN/);
    expect(headers).toMatch(/\/dashboard\.html[\s\S]*frame-ancestors 'none'/);
    expect(headers).toMatch(/\/dashboard\.html[\s\S]*X-Frame-Options: DENY/);
  });
});
