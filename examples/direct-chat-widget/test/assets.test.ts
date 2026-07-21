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
});
