import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyServerOptions } from 'fastify';

import { registerConversationRoutes } from './conversation/route.js';
import type { ConversationService } from './conversation/service.js';
import { registerEventRoutes } from './event/route.js';
import type { EventService } from './event/service.js';
import type { MessageService } from './message/service.js';
import { registerRunRoutes } from './run/route.js';
import type { RunService } from './run/service.js';
import { registerSessionRoutes, type BootstrapAnonymous } from './session/route.js';
import type { SessionTokenService } from './session/token.js';
import { registerStructuredInputRoutes } from './structured-input/route.js';
import type { StructuredInputService } from './structured-input/service.js';

export interface BuildServerOptions {
  checkDatabase: () => Promise<void>;
  closeDatabase?: () => Promise<void>;
  bootstrapAnonymous?: BootstrapAnonymous;
  conversationService?: ConversationService;
  messageService?: MessageService;
  eventService?: EventService;
  runService?: RunService;
  structuredInputService?: StructuredInputService;
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
  if (options.eventService && options.sessionTokens) {
    registerEventRoutes(server, options.eventService, options.sessionTokens);
  }
  if (options.runService && options.sessionTokens) {
    registerRunRoutes(server, options.runService, options.sessionTokens);
  }
  if (options.structuredInputService && options.sessionTokens) {
    registerStructuredInputRoutes(server, options.structuredInputService, options.sessionTokens);
  }

  return server;
}
