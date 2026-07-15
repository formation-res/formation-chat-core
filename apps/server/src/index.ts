import { loadConfig } from './config.js';
import { ConversationService } from './conversation/service.js';
import { checkDatabase, createDatabase } from './database/database.js';
import { migrateDatabase } from './database/migrate.js';
import { buildServer } from './server.js';
import { SessionService } from './session/service.js';
import { SessionTokenService } from './session/token.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const database = createDatabase(config);
  const sessions = new SessionService(
    database,
    config.sessionTokenSecret,
    config.sessionTokenTtlSeconds,
  );
  const sessionTokens = new SessionTokenService(
    config.sessionTokenSecret,
    config.sessionTokenTtlSeconds,
  );
  const conversations = new ConversationService(database);
  const server = buildServer({
    checkDatabase: async () => checkDatabase(database),
    bootstrapAnonymous: async (request, context) => sessions.bootstrapAnonymous(request, context),
    conversationService: conversations,
    sessionTokens,
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
