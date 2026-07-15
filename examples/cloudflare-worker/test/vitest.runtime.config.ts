import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

process.env.CHAT_CORE_SERVICE_TOKEN ??= 'runtime-test-secret';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { CHAT_CORE_SERVICE_TOKEN: 'runtime-test-secret' },
      },
    }),
  ],
});
