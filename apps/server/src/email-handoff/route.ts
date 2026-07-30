import {
  CreateEmailHandoffRequestSchema,
  type CreateEmailHandoffRequest,
} from '@formation-chat-core/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate, AuthorizationError } from '../auth/session-auth.js';
import { SessionTokenService } from '../session/token.js';
import { EmailHandoffApiError, EmailHandoffService } from './service.js';

export function registerEmailHandoffRoutes(
  server: FastifyInstance,
  handoffs: EmailHandoffService,
  tokens: SessionTokenService,
): void {
  server.post<{
    Params: { conversationId: string };
    Body: CreateEmailHandoffRequest;
    Headers: { 'idempotency-key': string };
  }>(
    '/v1/conversations/:conversationId/email-handoffs',
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
        body: CreateEmailHandoffRequestSchema,
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
        const claims = await authenticate(request, tokens, 'inputs:write');
        const result = await handoffs.create(
          claims,
          request.params.conversationId,
          request.body,
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
  if (!(error instanceof EmailHandoffApiError || error instanceof AuthorizationError)) throw error;
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
