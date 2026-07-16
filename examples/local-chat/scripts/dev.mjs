import pg from 'pg';
import { URL } from 'node:url';

import { buildLocalChat } from './build.mjs';
import { loadLocalChatConfig } from './config.mjs';
import { createLocalChatServer } from './local-server.mjs';
import { provisionLocalChatSite } from './provision.mjs';

const config = loadLocalChatConfig(process.env);
const outputDirectory = await buildLocalChat();
await requireReadyCore(config.coreBaseUrl);

if (process.env.LOCAL_CHAT_SKIP_PROVISION !== 'true') {
  const database = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await provisionLocalChatSite(database, config);
  } finally {
    await database.end();
  }
}

const server = createLocalChatServer({
  coreBaseUrl: config.coreBaseUrl,
  rootDirectory: outputDirectory,
  siteKey: config.siteKey,
});
await new Promise((resolve) =>
  server.listen({ host: config.host, port: config.port }, () => resolve(undefined)),
);
process.stdout.write(
  `Local Chat: ${config.origin}\nCore proxy: ${config.coreBaseUrl.origin}\nSite key: ${config.siteKey}\nAgent ref: ${config.agentRef}\n`,
);

const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

/** @param {URL} coreBaseUrl */
async function requireReadyCore(coreBaseUrl) {
  const healthUrl = new URL('/health/ready', coreBaseUrl);
  const response = await globalThis.fetch(healthUrl).catch(() => undefined);
  if (!response?.ok) {
    throw new Error(`Chat Core is not ready at ${healthUrl}. Start it before the local UI.`);
  }
}
