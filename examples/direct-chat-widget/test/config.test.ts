import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('reusable Worker deployment template', () => {
  it('keeps site configuration in each Worker instead of source control', async () => {
    const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

    expect(config).toContain('"keep_vars": true');
    expect(config).not.toMatch(/"vars"\s*:/);
    expect(config).not.toMatch(/"env"\s*:/);
  });

  it('provides a dashboard-preserving named deployment command', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['deploy:site']).toBe('wrangler deploy --keep-vars');
  });
});
