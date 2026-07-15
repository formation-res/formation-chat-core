import { createHash, randomUUID } from 'node:crypto';

import type {
  Message,
  MessageList,
  SessionTokenClaims,
  SubmitMessageRequest,
} from '@formation-chat-core/protocol';
import { sql, type Selectable, type Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { DatabaseSchema, MessageTable } from '../database/types.js';

type MessageScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'principalId'>;

export class MessageApiError extends Error {
  constructor(
    readonly code:
      'CONVERSATION_NOT_FOUND' | 'MESSAGE_NOT_FOUND' | 'INVALID_CURSOR' | 'IDEMPOTENCY_CONFLICT',
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'MessageApiError';
  }
}

const encodeCursor = (sequence: number): string =>
  Buffer.from(String(sequence)).toString('base64url');

const decodeCursor = (cursor: string): number | undefined => {
  try {
    const value = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!/^[1-9]\d*$/.test(value)) return undefined;
    const sequence = Number(value);
    return Number.isSafeInteger(sequence) ? sequence : undefined;
  } catch {
    return undefined;
  }
};

export class MessageService {
  constructor(private readonly database: Database) {}

  async submit(
    scope: MessageScope,
    conversationId: string,
    request: SubmitMessageRequest,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<Message> {
    const operation = `message:create:${conversationId}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.parts.map((part) => [part.type, part.text])))
      .digest('hex');
    const messageId = await this.database.transaction().execute(async (transaction) => {
      await this.lockIdempotency(transaction, scope, operation, idempotencyKey);
      const previous = await transaction
        .selectFrom('command_idempotency')
        .select(['request_hash', 'resource_id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('operation', '=', operation)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new MessageApiError(
            'IDEMPOTENCY_CONFLICT',
            409,
            'The idempotency key was already used for a different request.',
          );
        }
        return previous.resource_id;
      }

      const conversation = await transaction
        .selectFrom('conversations')
        .select(['conversation_id', 'agent_ref'])
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('conversation_id', '=', conversationId)
        .executeTakeFirst();
      if (!conversation) throw this.conversationNotFound();
      const participant = await transaction
        .selectFrom('conversation_participants')
        .select('participant_id')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('conversation_id', '=', conversationId)
        .where('kind', '=', 'user')
        .where('principal_id', '=', scope.principalId)
        .executeTakeFirstOrThrow();
      const updated = await transaction
        .updateTable('conversations')
        .set({ next_message_sequence: sql`next_message_sequence + 1`, updated_at: now })
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('conversation_id', '=', conversationId)
        .returning('next_message_sequence')
        .executeTakeFirstOrThrow();
      const id = randomUUID();
      const runId = randomUUID();
      const assistantMessageId = randomUUID();
      await transaction
        .insertInto('messages')
        .values({
          message_id: id,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          conversation_id: conversationId,
          sequence: updated.next_message_sequence - 1,
          participant_id: participant.participant_id,
          role: 'user',
          status: 'completed',
          parts: JSON.stringify(request.parts),
          completed_at: now,
        })
        .execute();
      await transaction
        .insertInto('agent_runs')
        .values({
          run_id: runId,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          conversation_id: conversationId,
          trigger_message_id: id,
          assistant_message_id: assistantMessageId,
          agent_ref: conversation.agent_ref,
          status: 'queued',
        })
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
    return this.get(scope, conversationId, messageId);
  }

  async list(
    scope: MessageScope,
    conversationId: string,
    request: { cursor?: string; limit: number },
  ): Promise<MessageList> {
    await this.requireConversation(scope, conversationId);
    const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;
    if (request.cursor && !cursor) {
      throw new MessageApiError('INVALID_CURSOR', 400, 'The cursor is invalid.');
    }
    let query = this.database
      .selectFrom('messages')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('conversation_id', '=', conversationId);
    if (cursor) query = query.where('sequence', '>', cursor);
    const rows = await query
      .orderBy('sequence', 'asc')
      .limit(request.limit + 1)
      .execute();
    const hasMore = rows.length > request.limit;
    const page = rows.slice(0, request.limit);
    const tail = page.at(-1);
    return {
      data: page.map((row) => this.mapMessage(row)),
      pagination:
        hasMore && tail
          ? { hasMore: true, nextCursor: encodeCursor(tail.sequence) }
          : { hasMore: false },
    };
  }

  private async get(
    scope: MessageScope,
    conversationId: string,
    messageId: string,
  ): Promise<Message> {
    await this.requireConversation(scope, conversationId);
    const row = await this.database
      .selectFrom('messages')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('conversation_id', '=', conversationId)
      .where('message_id', '=', messageId)
      .executeTakeFirst();
    if (!row) throw new MessageApiError('MESSAGE_NOT_FOUND', 404, 'The message was not found.');
    return this.mapMessage(row);
  }

  private async requireConversation(scope: MessageScope, conversationId: string): Promise<void> {
    const row = await this.database
      .selectFrom('conversations')
      .select('conversation_id')
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('principal_id', '=', scope.principalId)
      .where('conversation_id', '=', conversationId)
      .executeTakeFirst();
    if (!row) throw this.conversationNotFound();
  }

  private conversationNotFound() {
    return new MessageApiError('CONVERSATION_NOT_FOUND', 404, 'The conversation was not found.');
  }

  private mapMessage(row: Selectable<MessageTable>): Message {
    return {
      messageId: row.message_id,
      conversationId: row.conversation_id,
      sequence: row.sequence,
      participantId: row.participant_id,
      role: row.role,
      status: row.status,
      parts: row.parts,
      createdAt: row.created_at.toISOString(),
      ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
    };
  }

  private async lockIdempotency(
    transaction: Transaction<DatabaseSchema>,
    scope: MessageScope,
    operation: string,
    key: string,
  ): Promise<void> {
    const lockKey = `${scope.tenantId}:${scope.siteId}:${scope.principalId}:${operation}:${key}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(transaction);
  }
}
