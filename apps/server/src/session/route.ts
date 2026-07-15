import {
  AnonymousBootstrapRequestSchema,
  type AnonymousBootstrapRequest,
  type SessionBootstrapResponse,
  SessionBootstrapResponseSchema,
} from '@formation-chat-core/protocol';
import type { FastifyInstance } from 'fastify';

import {
  IdempotencyConflictError,
  SessionBootstrapError,
  type BootstrapContext,
} from './service.js';

export type BootstrapAnonymous = (
  request: AnonymousBootstrapRequest,
  context: BootstrapContext,
) => Promise<SessionBootstrapResponse>;

export function registerSessionRoutes(
  server: FastifyInstance,
  bootstrap: BootstrapAnonymous,
): void {
  server.post<{ Body: AnonymousBootstrapRequest }>(
    '/v1/sessions',
    {
      schema: {
        body: AnonymousBootstrapRequestSchema,
        headers: {
          type: 'object',
          required: ['origin', 'idempotency-key'],
          properties: {
            origin: { type: 'string', minLength: 1, maxLength: 2048 },
            'idempotency-key': {
              type: 'string',
              minLength: 1,
              maxLength: 255,
              pattern: '^[\\x21-\\x7E]+$',
            },
          },
        },
        response: { 200: SessionBootstrapResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await bootstrap(request.body, {
          origin: request.headers.origin as string,
          idempotencyKey: request.headers['idempotency-key'] as string,
        });
      } catch (error) {
        if (!(
          error instanceof SessionBootstrapError || error instanceof IdempotencyConflictError
        )) {
          throw error;
        }
        void reply.code(error.statusCode);
        return {
          error: {
            code: error.code,
            message: error.message,
            correlationId: request.id,
          },
        } as never;
      }
    },
  );
}
