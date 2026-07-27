import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseJsonc, verifyProductionConfig } from '../scripts/verify-production-config.mjs';

describe('Cloudflare gateway production config', () => {
  it('routes authentication requests through the Worker before static assets', async () => {
    const configPath = new URL('../wrangler.jsonc', import.meta.url);
    const config = parseJsonc(await readFile(configPath, 'utf8'), configPath.pathname);

    expect(config.assets.run_worker_first).toContain('/auth/*');
  });

  it('rejects a production config that lets static assets handle authentication', () => {
    const config = {
      vars: {
        CHAT_CORE_BASE_URL: 'https://chat-core.formationxyz.com',
        CHAT_SITES: '{"chat.formationxyz.com":{"siteKey":"askmailfront-main"}}',
      },
      secrets: { required: ['HAYSTACK_CONNECTOR_TOKEN'] },
      assets: { run_worker_first: ['/widget/config', '/v1/*'] },
      routes: ['chat.formationxyz.com'],
    };

    expect(verifyProductionConfig(config)).toContain(
      'assets.run_worker_first must include /auth/*.',
    );
  });
});
