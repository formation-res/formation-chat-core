import { loadConfig } from './config.js';
import { ConversationService } from './conversation/service.js';
import { checkDatabase, createDatabase } from './database/database.js';
import { migrateDatabase } from './database/migrate.js';
import { EventBroker } from './event/broker.js';
import { EventService } from './event/service.js';
import { EventStore } from './event/store.js';
import { MessageService } from './message/service.js';
import { RunCancellationCoordinator } from './run/cancellation.js';
import { createConnectorResolver } from './run/connectors.js';
import { RunService } from './run/service.js';
import { RunWorker } from './run/worker.js';
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
  const messages = new MessageService(database);
  const cancellation = new RunCancellationCoordinator();
  const runs = new RunService(database, cancellation);
  const events = new EventService(
    new EventStore(database, { retentionMaxEvents: config.eventRetentionMaxEvents }),
    new EventBroker({ subscriberBufferSize: config.eventSubscriberBufferSize }),
  );
  const worker =
    config.connectorMode === 'disabled'
      ? undefined
      : new RunWorker(
          database,
          events,
          createConnectorResolver(config),
          { leaseMs: config.runLeaseMs, maxAttempts: config.runMaxAttempts },
          cancellation,
        );
  const workerAbort = new AbortController();
  let workerPromise: Promise<void> | undefined;
  const server = buildServer({
    checkDatabase: async () => checkDatabase(database),
    bootstrapAnonymous: async (request, context) => sessions.bootstrapAnonymous(request, context),
    conversationService: conversations,
    messageService: messages,
    eventService: events,
    runService: runs,
    sessionTokens,
    closeDatabase: async () => {
      workerAbort.abort();
      await workerPromise?.catch(() => undefined);
      await database.destroy();
    },
    logger: { level: config.logLevel },
  });

  try {
    await migrateDatabase(database);
    await server.listen({ host: config.host, port: config.port });
    if (worker) {
      workerPromise = worker.run(workerAbort.signal, config.runWorkerPollIntervalMs);
      void workerPromise.catch(async () => {
        if (workerAbort.signal.aborted) return;
        process.stderr.write('RunWorkerError: background worker stopped\n');
        await server.close();
      });
    }
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
