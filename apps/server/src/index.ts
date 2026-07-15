import { loadConfig } from './config.js';
import { checkDatabase, createDatabase } from './database/database.js';
import { migrateDatabase } from './database/migrate.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const database = createDatabase(config);
  const server = buildServer({
    checkDatabase: async () => checkDatabase(database),
    closeDatabase: async () => database.destroy(),
    logger: { level: config.logLevel },
  });

  try {
    await migrateDatabase(database);
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    await server.close();
    throw error;
  }

  const shutdown = async () => server.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'StartupError';
  process.stderr.write(`${name}: server startup failed\n`);
  process.exitCode = 1;
});
