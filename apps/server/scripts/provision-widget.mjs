import { readFile } from 'node:fs/promises';

import { createDatabase } from '../dist/database/database.js';
import { migrateDatabase } from '../dist/database/migrate.js';
import { provisionWidgetRegistry } from '../dist/provisioning/widget.js';

const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write('Usage: npm run provision:widget -- <config.json>\n');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL is required.\n');
  process.exitCode = 1;
} else {
  const database = createDatabase({ databaseUrl: process.env.DATABASE_URL, databasePoolMax: 1 });
  try {
    const raw = await readFile(configPath, 'utf8');
    await migrateDatabase(database);
    const config = await provisionWidgetRegistry(database, JSON.parse(raw));
    process.stdout.write(
      `Provisioned widget ${config.widget.widgetKey} for ${config.site.allowedOrigins.join(', ')}.\n`,
    );
  } finally {
    await database.destroy();
  }
}
