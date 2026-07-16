import {
  AdminConversationFilterSchema,
  type AdminConversationFilter,
} from '@formation-chat-core/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AdminApiError, AdminQueryService } from './service.js';
import { AdminTokenService } from './token.js';

const opaqueId = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
} as const;
const pageQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export class AdminAuthorizationError extends Error {
  constructor(readonly statusCode: 401 | 403) {
    super(
      statusCode === 401 ? 'Admin authentication is required.' : 'Admin read scope is required.',
    );
    this.name = 'AdminAuthorizationError';
  }
}

export function registerAdminRoutes(
  server: FastifyInstance,
  service: AdminQueryService,
  tokens: AdminTokenService,
): void {
  server.get<{ Querystring: AdminConversationFilter }>(
    '/v1/admin/conversations',
    {
      schema: { querystring: AdminConversationFilterSchema },
    },
    async (request, reply) => {
      try {
        const claims = await authenticateAdmin(request, tokens);
        return await service.listConversations(claims, {
          ...request.query,
          limit: request.query.limit ?? 20,
        });
      } catch (error) {
        return sendError(error, request, reply);
      }
    },
  );

  server.get<{ Params: { conversationId: string } }>(
    '/v1/admin/conversations/:conversationId',
    { schema: { params: idParams } },
    async (request, reply) => {
      try {
        return await service.getConversation(
          await authenticateAdmin(request, tokens),
          request.params.conversationId,
        );
      } catch (error) {
        return sendError(error, request, reply);
      }
    },
  );

  for (const resource of ['messages', 'events'] as const) {
    server.get<{
      Params: { conversationId: string };
      Querystring: { cursor?: string; limit?: number };
    }>(
      `/v1/admin/conversations/:conversationId/${resource}`,
      { schema: { params: idParams, querystring: pageQuery } },
      async (request, reply) => {
        try {
          const claims = await authenticateAdmin(request, tokens);
          const page = {
            ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
            limit: request.query.limit ?? 20,
          };
          return resource === 'messages'
            ? await service.listMessages(claims, request.params.conversationId, page)
            : await service.listEvents(claims, request.params.conversationId, page);
        } catch (error) {
          return sendError(error, request, reply);
        }
      },
    );
  }
}

const idParams = {
  type: 'object',
  additionalProperties: false,
  required: ['conversationId'],
  properties: { conversationId: opaqueId },
} as const;

async function authenticateAdmin(request: FastifyRequest, tokens: AdminTokenService) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new AdminAuthorizationError(401);
  try {
    const claims = await tokens.verify(authorization.slice(7));
    if (!claims.scopes.some((scope) => scope === 'admin:read' || scope === 'admin:internal')) {
      throw new AdminAuthorizationError(403);
    }
    return claims;
  } catch (error) {
    if (error instanceof AdminAuthorizationError) throw error;
    throw new AdminAuthorizationError(401);
  }
}

function sendError(
  error: unknown,
  request: FastifyRequest,
  reply: { code(status: number): unknown },
) {
  if (!(error instanceof AdminApiError || error instanceof AdminAuthorizationError)) throw error;
  void reply.code(error.statusCode);
  return {
    error: {
      code:
        error instanceof AdminAuthorizationError
          ? error.statusCode === 401
            ? 'UNAUTHORIZED'
            : 'FORBIDDEN'
          : error.code,
      message: error.message,
      correlationId: request.id,
    },
  };
}
