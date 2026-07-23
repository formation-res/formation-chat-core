import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

process.env.HAYSTACK_CONNECTOR_TOKEN ??= 'runtime-test-secret';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { HAYSTACK_CONNECTOR_TOKEN: 'runtime-test-secret' },
      },
    }),
  ],
});
