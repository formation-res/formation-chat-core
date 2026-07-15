import {
  CreateConversationRequestSchema,
  type SessionTokenClaims,
} from '@formation-chat-core/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { SessionTokenService } from '../session/token.js';
import { ConversationApiError, ConversationService } from './service.js';

class AuthorizationError extends Error {
  constructor(readonly statusCode: 401 | 403) {
    super(
      statusCode === 401 ? 'Authentication is required.' : 'The token lacks the required scope.',
    );
  }
}

const authenticate = async (
  request: FastifyRequest,
  tokens: SessionTokenService,
  scope: 'conversations:read' | 'conversations:write',
): Promise<SessionTokenClaims> => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new AuthorizationError(401);
  try {
    const claims = await tokens.verify(authorization.slice(7));
    if (!claims.scopes.includes(scope)) throw new AuthorizationError(403);
    return claims;
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw new AuthorizationError(401);
  }
};

export function registerConversationRoutes(
  server: FastifyInstance,
  conversations: ConversationService,
  tokens: SessionTokenService,
): void {
  const formatError = (error: unknown, request: FastifyRequest) => {
    if (!(error instanceof ConversationApiError || error instanceof AuthorizationError))
      throw error;
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
  };

  server.post(
    '/v1/conversations',
    {
      schema: {
        body: CreateConversationRequestSchema,
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
        const result = await conversations.create(
          claims,
          request.headers['idempotency-key'] as string,
        );
        void reply.code(201);
        return result;
      } catch (error) {
        const failure = formatError(error, request);
        void reply.code(failure.statusCode);
        return failure.body;
      }
    },
  );

  server.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/v1/conversations',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const claims = await authenticate(request, tokens, 'conversations:read');
        return await conversations.list(claims, {
          ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
          limit: request.query.limit ?? 20,
        });
      } catch (error) {
        const failure = formatError(error, request);
        void reply.code(failure.statusCode);
        return failure.body;
      }
    },
  );

  server.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId',
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
      },
    },
    async (request, reply) => {
      try {
        const claims = await authenticate(request, tokens, 'conversations:read');
        return await conversations.get(claims, request.params.conversationId);
      } catch (error) {
        const failure = formatError(error, request);
        void reply.code(failure.statusCode);
        return failure.body;
      }
    },
  );
}
