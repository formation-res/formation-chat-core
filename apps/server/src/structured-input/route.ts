import {
  SubmitStructuredInputRequestSchema,
  type SubmitStructuredInputRequest,
} from '@formation-chat-core/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate, AuthorizationError } from '../auth/session-auth.js';
import { SessionTokenService } from '../session/token.js';
import { StructuredInputApiError, StructuredInputService } from './service.js';

const opaqueId = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
} as const;

export function registerStructuredInputRoutes(
  server: FastifyInstance,
  inputs: StructuredInputService,
  tokens: SessionTokenService,
): void {
  server.post<{
    Params: { conversationId: string; requestId: string };
    Body: SubmitStructuredInputRequest;
    Headers: { 'idempotency-key': string };
  }>(
    '/v1/conversations/:conversationId/inputs/:requestId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['conversationId', 'requestId'],
          properties: { conversationId: opaqueId, requestId: opaqueId },
        },
        body: SubmitStructuredInputRequestSchema,
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
        return await inputs.submit(
          claims,
          request.params.conversationId,
          request.params.requestId,
          request.body,
          request.headers['idempotency-key'],
        );
      } catch (error) {
        const failure = formatError(error, request);
        void reply.code(failure.statusCode);
        return failure.body;
      }
    },
  );
}

function formatError(error: unknown, request: FastifyRequest) {
  if (!(error instanceof StructuredInputApiError || error instanceof AuthorizationError)) {
    throw error;
  }
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
