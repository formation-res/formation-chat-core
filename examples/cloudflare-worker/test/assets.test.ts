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
    expect(dashboard).toContain('<div id="root"></div>');
    expect(dashboard).toContain('src="/dashboard.js"');
  });

  it('keeps the chat iframe frameable only same-origin while blocking dashboard framing', async () => {
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(headers).toMatch(/\/\*[\s\S]*frame-ancestors 'self'/);
    expect(headers).toMatch(/\/\*[\s\S]*X-Frame-Options: SAMEORIGIN/);
    expect(headers).toMatch(/\/dashboard\.html[\s\S]*frame-ancestors 'none'/);
    expect(headers).toMatch(/\/dashboard\.html[\s\S]*X-Frame-Options: DENY/);
  });
});
