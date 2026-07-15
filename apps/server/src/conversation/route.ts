import {
  CreateConversationRequestSchema,
  SubmitMessageRequestSchema,
  type SubmitMessageRequest,
} from '@formation-chat-core/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate, AuthorizationError } from '../auth/session-auth.js';
import { MessageApiError, MessageService } from '../message/service.js';
import { SessionTokenService } from '../session/token.js';
import { ConversationApiError, ConversationService } from './service.js';

export function registerConversationRoutes(
  server: FastifyInstance,
  conversations: ConversationService,
  messages: MessageService,
  tokens: SessionTokenService,
): void {
  const formatError = (error: unknown, request: FastifyRequest) => {
    if (!(
      error instanceof ConversationApiError ||
      error instanceof MessageApiError ||
      error instanceof AuthorizationError
    ))
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

  server.post<{ Params: { conversationId: string }; Body: SubmitMessageRequest }>(
    '/v1/conversations/:conversationId/messages',
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
        body: SubmitMessageRequestSchema,
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
        const result = await messages.submit(
          claims,
          request.params.conversationId,
          request.body,
          request.headers['idempotency-key'] as string,
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

  server.get<{
    Params: { conversationId: string };
    Querystring: { cursor?: string; limit?: number };
  }>(
    '/v1/conversations/:conversationId/messages',
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
        querystring: {
          type: 'object',
          properties: {
            cursor: {
              type: 'string',
              minLength: 1,
              maxLength: 512,
              pattern: '^[A-Za-z0-9_-]+$',
            },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const claims = await authenticate(request, tokens, 'conversations:read');
        return await messages.list(claims, request.params.conversationId, {
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
}
