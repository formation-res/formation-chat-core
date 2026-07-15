import { once } from 'node:events';
import type { ServerResponse } from 'node:http';

import type { PublicConversationEvent } from '@formation-chat-core/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate, AuthorizationError } from '../auth/session-auth.js';
import { SessionTokenService } from '../session/token.js';
import type { EventSubscription } from './broker.js';
import { EventService } from './service.js';
import { EventApiError } from './store.js';

export function registerEventRoutes(
  server: FastifyInstance,
  events: EventService,
  tokens: SessionTokenService,
): void {
  server.get<{
    Params: { conversationId: string };
    Headers: { 'last-event-id'?: string };
  }>(
    '/v1/conversations/:conversationId/events',
    {
      schema: {
        params: {
          type: 'object',
          required: ['conversationId'],
          properties: {
            conversationId: {
              type: 'string',
              minLength: 1,
              maxLength: 128,
              pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
            },
          },
        },
        headers: {
          type: 'object',
          properties: {
            'last-event-id': {
              type: 'string',
              minLength: 1,
              maxLength: 128,
              pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      let subscription: EventSubscription | undefined;
      try {
        const claims = await authenticate(request, tokens, 'events:read');
        subscription = events.subscribe(request.params.conversationId);
        const replay = await events.replay(
          claims,
          request.params.conversationId,
          request.headers['last-event-id'],
        );

        reply.hijack();
        reply.raw.writeHead(200, {
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
          'x-correlation-id': request.id,
        });
        reply.raw.flushHeaders();
        reply.raw.once('close', () => subscription?.close());

        if (replay.kind === 'sync-required') {
          await writeEvent(reply.raw, replay.event);
          reply.raw.end();
          return;
        }

        let lastSequence = 0;
        for (const event of replay.events) {
          await writeEvent(reply.raw, event);
          lastSequence = event.sequence;
        }
        while (!reply.raw.destroyed) {
          const notification = await subscription.next();
          if (notification.kind === 'closed') break;
          if (notification.kind === 'overflow') {
            await writeEvent(
              reply.raw,
              await events.syncRequired(claims, request.params.conversationId),
            );
            break;
          }
          if (notification.event.sequence <= lastSequence) continue;
          await writeEvent(reply.raw, notification.event);
          lastSequence = notification.event.sequence;
        }
        if (!reply.raw.destroyed) reply.raw.end();
      } catch (error) {
        subscription?.close();
        if (reply.sent) {
          reply.raw.destroy();
          return;
        }
        const failure = formatError(error, request);
        void reply.code(failure.statusCode).send(failure.body);
      }
    },
  );
}

async function writeEvent(response: ServerResponse, event: PublicConversationEvent): Promise<void> {
  const frame = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (response.write(frame)) return;
  await Promise.race([once(response, 'drain'), once(response, 'close')]);
}

function formatError(error: unknown, request: FastifyRequest) {
  if (!(error instanceof EventApiError || error instanceof AuthorizationError)) throw error;
  return {
    statusCode: error.statusCode,
    body: {
      error: {
        code:
          error instanceof AuthorizationError
            ? error.statusCode === 401
              ? 'UNAUTHORIZED'
              : 'FORBIDDEN'
            : error.code,
        message: error.message,
        correlationId: request.id,
      },
    },
  };
}
