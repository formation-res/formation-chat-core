import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('embeddable widget asset', () => {
  it('can be imported as a module from another website', async () => {
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(headers).toContain('/widget.js');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
    expect(headers).toContain('Cross-Origin-Resource-Policy: cross-origin');
  });

  it('uses a restrained textarea focus state and muted accent', async () => {
    const styles = await readFile(new URL('../site/widget.css', import.meta.url), 'utf8');

    expect(styles).toContain('--chat-accent: #c7d58a;');
    expect(styles).not.toContain('#d8ff63');
    expect(styles).toContain('textarea:focus-visible {');
    expect(styles).toContain('box-shadow: inset 0 0 0 1px var(--chat-ink);');
    expect(styles).toContain('outline: none;');
  });

  it('provides customizable launcher modes and distinct header actions', async () => {
    const source = await readFile(new URL('../site/widget.ts', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../site/widget.css', import.meta.url), 'utf8');

    expect(source).toContain("this.getAttribute('launcher-type') === 'button'");
    expect(source).toContain("this.getAttribute('launcher-image')");
    expect(source).toContain("this.getAttribute('launcher-tooltip')");
    expect(source).toContain("Ceci n'est pas une bot. ☝");
    expect(source).toContain('class="launcher-agent"');
    expect(source).toContain("this.getAttribute('launcher-text') ?? 'Chat'");
    expect(styles).toContain('.launcher-agent-button');
    expect(styles).toContain('.launcher-text-button');
    expect(styles).toMatch(/\.launcher \{[\s\S]*?border: 0;/);
    expect(styles).not.toMatch(/\.launcher-agent \{[^}]*animation:/);
    expect(styles).toMatch(/\.launcher-agent svg \{[^}]*animation: agent-float/);
    expect(styles).toContain('.launcher-agent-button + .panel');
    expect(styles).toContain('.launcher-tooltip');
    expect(styles).toMatch(/header \{[\s\S]*?background: var\(--chat-accent\);/);
    expect(styles).toMatch(/\.message\.user \{[\s\S]*?background: var\(--chat-accent\);/);
    expect(styles).toMatch(/\.message\.assistant \{[\s\S]*?background: transparent;/);
    expect(styles).toMatch(/\.panel \{[\s\S]*?border: 0;/);
    expect(styles).toContain('.header-actions button:hover:not(:disabled)');
    expect(styles).toContain('.close {');
    expect(styles).toContain('font-size: 1.75rem;');
  });
});
