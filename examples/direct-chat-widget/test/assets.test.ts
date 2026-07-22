import { readFile, stat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const artworkVariants = {
  blue: 'agent-shadow-tooltip-blue.webp',
  'dark-green': 'agent-shadow-tooltip-dark-green.webp',
  earth: 'agent-shadow-tooltip-earth.webp',
  light: 'agent-shadow-tooltip-light.webp',
  rgb: 'agent-shadow-tooltip-rgb.webp',
  'rgb-neon': 'agent-shadow-tooltip-rgb-neon.webp',
} as const;

describe('embeddable widget asset', () => {
  it('can be imported as a module from another website', async () => {
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(headers).toContain('/widget.js');
    expect(headers).toContain('/agent-shadow-tooltip.webp');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
    expect(headers).toContain('Cross-Origin-Resource-Policy: cross-origin');
  });

  it('uses a restrained textarea focus state and artwork-matched accent', async () => {
    const styles = await readFile(new URL('../site/widget.css', import.meta.url), 'utf8');

    expect(styles).toContain('--chat-accent: #efe1bb;');
    expect(styles).toMatch(/\.launcher-tooltip-copy \{[\s\S]*?background: var\(--chat-accent\);/);
    expect(styles).not.toContain('#d8ff63');
    expect(styles).toContain('textarea:focus-visible {');
    expect(styles).toContain('box-shadow: inset 0 0 0 1px var(--chat-ink);');
    expect(styles).toContain('outline: none;');
  });

  it('bundles every selectable artwork key and safely defaults to the original', async () => {
    const source = await readFile(new URL('../site/widget.ts', import.meta.url), 'utf8');
    const buildScript = await readFile(
      new URL('../scripts/build-site.mjs', import.meta.url),
      'utf8',
    );
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(source).toContain("this.getAttribute('artwork-key')");
    expect(source).toContain("?? 'earth'");
    for (const [key, filename] of Object.entries(artworkVariants)) {
      expect(source).toContain(`['${key}',`);
      expect(source).toContain(filename);
      expect(buildScript).toContain(`'${filename}'`);
      expect(headers).toContain(`/${filename}`);
      expect((await stat(new URL(`../site/${filename}`, import.meta.url))).size).toBeLessThan(
        250_000,
      );
    }
  });

  it('provides customizable launcher modes and distinct header actions', async () => {
    const source = await readFile(new URL('../site/widget.ts', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../site/widget.css', import.meta.url), 'utf8');

    expect(source).toContain("this.getAttribute('launcher-type') === 'button'");
    expect(source).toContain("this.getAttribute('launcher-image')");
    expect(source).toContain("this.getAttribute('launcher-tooltip')");
    expect(source).toContain(`"Ceci n'est pas une chatbot."`);
    expect(source).toContain('Artwork - in respectful admiration, inspired by René Magritte');
    expect(source).toContain('class="launcher-tooltip-artwork"');
    expect(source).toContain('class="launcher-tooltip-expand"');
    expect(source).toContain('class="launcher-agent"');
    expect(source).toContain("this.getAttribute('launcher-text') ?? 'Chat'");
    expect(styles).toContain('.launcher-agent-button');
    expect(styles).toContain('.launcher-text-button');
    expect(styles).toMatch(/\.launcher \{[\s\S]*?border: 0;/);
    expect(styles).not.toMatch(/\.launcher-agent \{[^}]*animation:/);
    expect(styles).toMatch(/\.launcher-agent svg \{[^}]*animation: agent-float/);
    expect(styles).toContain('.launcher-shell-agent + .panel');
    expect(styles).toContain('.launcher-tooltip');
    expect(styles).toContain('.launcher-shell:hover');
    expect(styles).toMatch(/header \{[\s\S]*?background: var\(--chat-accent\);/);
    expect(styles).toMatch(/\.message\.user \{[\s\S]*?background: var\(--chat-accent\);/);
    expect(styles).toMatch(/\.message\.assistant \{[\s\S]*?background: transparent;/);
    expect(styles).toMatch(/\.panel \{[\s\S]*?border: 0;/);
    expect(styles).toContain('.header-actions button:hover:not(:disabled)');
    expect(source).toContain('class="close-icon"');
    expect(styles).toContain('.close {');
    expect(styles).toMatch(/\.close \{[\s\S]*?display: grid;/);
    expect(styles).toMatch(/\.close \{[\s\S]*?place-items: center;/);

    const artwork = await stat(new URL('../site/agent-shadow-tooltip.webp', import.meta.url));
    expect(artwork.size).toBeLessThan(250_000);
  });
});
