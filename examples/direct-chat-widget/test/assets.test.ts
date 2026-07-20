import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('embeddable widget asset', () => {
  it('can be imported as a module from another website', async () => {
    const headers = await readFile(new URL('../site/_headers', import.meta.url), 'utf8');

    expect(headers).toContain('/widget.js');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
    expect(headers).toContain('Cross-Origin-Resource-Policy: cross-origin');
  });
});
