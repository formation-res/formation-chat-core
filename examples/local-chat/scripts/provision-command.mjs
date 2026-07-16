import pg from 'pg';

import { loadLocalChatConfig } from './config.mjs';
import { provisionLocalChatSite } from './provision.mjs';

const config = loadLocalChatConfig(process.env);
const database = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  await provisionLocalChatSite(database, config);
  process.stdout.write(
    `Provisioned site ${config.siteKey} for ${config.origin} with agent ${config.agentRef}.\n`,
  );
} finally {
  await database.end();
}
