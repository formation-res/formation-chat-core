import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyServerOptions } from 'fastify';

import { registerConversationRoutes } from './conversation/route.js';
import type { ConversationService } from './conversation/service.js';
import type { MessageService } from './message/service.js';
import { registerSessionRoutes, type BootstrapAnonymous } from './session/route.js';
import type { SessionTokenService } from './session/token.js';

export interface BuildServerOptions {
  checkDatabase: () => Promise<void>;
  closeDatabase?: () => Promise<void>;
  bootstrapAnonymous?: BootstrapAnonymous;
  conversationService?: ConversationService;
  messageService?: MessageService;
  sessionTokens?: SessionTokenService;
  logger?: FastifyServerOptions['logger'];
}

export function buildServer(options: BuildServerOptions) {
  const server = Fastify({
    bodyLimit: 1024 * 1024,
    genReqId: () => randomUUID(),
    logger: options.logger ?? true,
    requestIdHeader: false,
    requestTimeout: 120_000,
  });

  server.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-correlation-id', request.id);
    return payload;
  });

  if (options.closeDatabase) server.addHook('onClose', options.closeDatabase);

  server.get('/health/live', async () => ({ status: 'ok' as const }));

  server.get('/health/ready', async (request, reply) => {
    try {
      await options.checkDatabase();
      return { status: 'ready' as const };
    } catch {
      void reply.code(503);
      return {
        status: 'unavailable' as const,
        error: {
          code: 'DATABASE_UNAVAILABLE' as const,
          message: 'The database is unavailable.',
          correlationId: request.id,
        },
      };
    }
  });

  if (options.bootstrapAnonymous) registerSessionRoutes(server, options.bootstrapAnonymous);
  if (options.conversationService && options.messageService && options.sessionTokens) {
    registerConversationRoutes(
      server,
      options.conversationService,
      options.messageService,
      options.sessionTokens,
    );
  }

  return server;
}
