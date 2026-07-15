import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate, AuthorizationError } from '../auth/session-auth.js';
import { SessionTokenService } from '../session/token.js';
import { RunApiError, RunService } from './service.js';

export function registerRunRoutes(
  server: FastifyInstance,
  runs: RunService,
  tokens: SessionTokenService,
): void {
  server.post<{
    Params: { conversationId: string };
    Headers: { 'idempotency-key': string };
  }>(
    '/v1/conversations/:conversationId/cancel',
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
          required: ['idempotency-key'],
          properties: {
            'idempotency-key': {
              type: 'string',
              minLength: 1,
              maxLength: 255,
              pattern: '^[\\x21-\\x7E]+$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const claims = await authenticate(request, tokens, 'conversations:write');
        const result = await runs.cancel(
          claims,
          request.params.conversationId,
          request.headers['idempotency-key'],
        );
        void reply.code(202);
        return result;
      } catch (error) {
        const failure = formatError(error, request);
        void reply.code(failure.statusCode);
        return failure.body;
      }
    },
  );
}

function formatError(error: unknown, request: FastifyRequest) {
  if (!(error instanceof RunApiError || error instanceof AuthorizationError)) throw error;
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
