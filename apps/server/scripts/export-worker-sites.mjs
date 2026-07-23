import { createDatabase } from '../dist/database/database.js';
import { migrateDatabase } from '../dist/database/migrate.js';
import { exportWorkerChatSites } from '../dist/provisioning/widget.js';

if (!process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL is required.\n');
  process.exitCode = 1;
} else {
  const database = createDatabase({ databaseUrl: process.env.DATABASE_URL, databasePoolMax: 1 });
  try {
    await migrateDatabase(database);
    const sites = await exportWorkerChatSites(database);
    process.stdout.write(`${JSON.stringify(sites)}\n`);
  } finally {
    await database.destroy();
  }
}
