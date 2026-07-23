import { createHash, randomUUID } from 'node:crypto';

import type {
  Conversation,
  ConversationList,
  SessionTokenClaims,
} from '@formation-chat-core/protocol';
import { sql, type Kysely, type Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { DatabaseSchema } from '../database/types.js';
import { decodeConversationCursor, encodeConversationCursor } from './cursor.js';

type QueryDatabase = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
type ConversationScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'agentRef' | 'principalId'>;

export class ConversationApiError extends Error {
  constructor(
    readonly code: 'CONVERSATION_NOT_FOUND' | 'INVALID_CURSOR' | 'IDEMPOTENCY_CONFLICT',
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'ConversationApiError';
  }
}

export class ConversationService {
  constructor(private readonly database: Database) {}

  async create(scope: ConversationScope, idempotencyKey: string): Promise<Conversation> {
    const operation = 'conversation:create';
    const requestHash = createHash('sha256').update('{}').digest('hex');
    const conversationId = await this.database.transaction().execute(async (transaction) => {
      await this.lockIdempotency(transaction, scope, operation, idempotencyKey);
      const previous = await this.findIdempotency(transaction, scope, operation, idempotencyKey);
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new ConversationApiError(
            'IDEMPOTENCY_CONFLICT',
            409,
            'The idempotency key was already used for a different request.',
          );
        }
        return previous.resource_id;
      }

      const id = randomUUID();
      const userParticipantId = randomUUID();
      const agentParticipantId = randomUUID();
      await transaction
        .insertInto('conversations')
        .values({
          conversation_id: id,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          principal_id: scope.principalId,
          agent_ref: scope.agentRef,
          status: 'active',
        })
        .execute();
      await transaction
        .insertInto('conversation_participants')
        .values([
          {
            participant_id: userParticipantId,
            tenant_id: scope.tenantId,
            site_id: scope.siteId,
            conversation_id: id,
            kind: 'user',
            principal_id: scope.principalId,
            agent_ref: null,
          },
          {
            participant_id: agentParticipantId,
            tenant_id: scope.tenantId,
            site_id: scope.siteId,
            conversation_id: id,
            kind: 'agent',
            principal_id: null,
            agent_ref: scope.agentRef,
          },
        ])
        .execute();
      await transaction
        .insertInto('command_idempotency')
        .values({
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          principal_id: scope.principalId,
          operation,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          resource_id: id,
        })
        .execute();
      return id;
    });
    return this.get(scope, conversationId);
  }

  async get(scope: ConversationScope, conversationId: string): Promise<Conversation> {
    const conversation = await this.database
      .selectFrom('conversations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('principal_id', '=', scope.principalId)
      .where('conversation_id', '=', conversationId)
      .executeTakeFirst();
    if (!conversation) {
      throw new ConversationApiError(
        'CONVERSATION_NOT_FOUND',
        404,
        'The conversation was not found.',
      );
    }
    const participants = await this.database
      .selectFrom('conversation_participants')
      .select(['participant_id', 'kind', 'principal_id', 'agent_ref'])
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('conversation_id', '=', conversationId)
      .execute();
    participants.sort((left, right) =>
      left.kind === right.kind ? 0 : left.kind === 'user' ? -1 : 1,
    );
    return {
      conversationId: conversation.conversation_id,
      tenantId: conversation.tenant_id,
      siteId: conversation.site_id,
      principalId: conversation.principal_id,
      agentRef: conversation.agent_ref,
      status: conversation.status,
      participants: participants.map((participant) =>
        participant.kind === 'user'
          ? {
              participantId: participant.participant_id,
              kind: 'user' as const,
              principalId: participant.principal_id as string,
            }
          : {
              participantId: participant.participant_id,
              kind: 'agent' as const,
              agentRef: participant.agent_ref as string,
            },
      ),
      createdAt: conversation.created_at.toISOString(),
      updatedAt: conversation.updated_at.toISOString(),
    };
  }

  async list(
    scope: ConversationScope,
    request: { cursor?: string; limit: number },
  ): Promise<ConversationList> {
    const cursor = request.cursor ? decodeConversationCursor(request.cursor) : undefined;
    if (request.cursor && !cursor) {
      throw new ConversationApiError('INVALID_CURSOR', 400, 'The cursor is invalid.');
    }
    let query = this.database
      .selectFrom('conversations')
      .select(['conversation_id', 'created_at'])
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('principal_id', '=', scope.principalId);
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      query = query.where((expression) =>
        expression.or([
          expression('created_at', '<', createdAt),
          expression.and([
            expression('created_at', '=', createdAt),
            expression('conversation_id', '<', cursor.conversationId),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('conversation_id', 'desc')
      .limit(request.limit + 1)
      .execute();
    const hasMore = rows.length > request.limit;
    const page = rows.slice(0, request.limit);
    const data = await Promise.all(page.map((row) => this.get(scope, row.conversation_id)));
    const tail = page.at(-1);
    return {
      data,
      pagination:
        hasMore && tail
          ? {
              hasMore: true,
              nextCursor: encodeConversationCursor({
                createdAt: tail.created_at.toISOString(),
                conversationId: tail.conversation_id,
              }),
            }
          : { hasMore: false },
    };
  }

  private async lockIdempotency(
    transaction: Transaction<DatabaseSchema>,
    scope: ConversationScope,
    operation: string,
    key: string,
  ): Promise<void> {
    const lockKey = `${scope.tenantId}:${scope.siteId}:${scope.principalId}:${operation}:${key}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(transaction);
  }

  private findIdempotency(
    database: QueryDatabase,
    scope: ConversationScope,
    operation: string,
    key: string,
  ) {
    return database
      .selectFrom('command_idempotency')
      .select(['request_hash', 'resource_id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('principal_id', '=', scope.principalId)
      .where('operation', '=', operation)
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
  }
}
