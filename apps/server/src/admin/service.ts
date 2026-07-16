import type {
  AdminConversationFilter,
  AdminConversationList,
  AdminEventList,
  AdminMessageList,
  AdminTokenClaims,
  Conversation,
  ConversationEvent,
  Message,
} from '@formation-chat-core/protocol';
import type { Selectable } from 'kysely';

import type { Database } from '../database/database.js';
import type {
  ConversationEventTable,
  ConversationParticipantTable,
  ConversationTable,
  MessageTable,
} from '../database/types.js';
import {
  decodeSequenceCursor,
  decodeTimeCursor,
  encodeSequenceCursor,
  encodeTimeCursor,
} from './cursor.js';

type AdminScope = Pick<AdminTokenClaims, 'tenantId' | 'siteIds' | 'scopes'>;

export class AdminApiError extends Error {
  constructor(
    readonly code: 'FORBIDDEN_SITE' | 'INVALID_CURSOR' | 'INVALID_DATE_RANGE' | 'NOT_FOUND',
    readonly statusCode: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export class AdminQueryService {
  constructor(private readonly database: Database) {}

  async listConversations(
    scope: AdminScope,
    filter: AdminConversationFilter & { limit: number },
  ): Promise<AdminConversationList> {
    this.validateFilter(scope, filter);
    const cursor = filter.cursor ? decodeTimeCursor('conversation', filter.cursor) : undefined;
    if (filter.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('conversations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds);
    if (filter.siteId) query = query.where('site_id', '=', filter.siteId);
    if (filter.agentRef) query = query.where('agent_ref', '=', filter.agentRef);
    if (filter.status) query = query.where('status', '=', filter.status);
    if (filter.createdAfter) query = query.where('created_at', '>=', new Date(filter.createdAfter));
    if (filter.createdBefore)
      query = query.where('created_at', '<', new Date(filter.createdBefore));
    if (cursor) {
      const timestamp = new Date(cursor.timestamp);
      query = query.where((expression) =>
        expression.or([
          expression('created_at', '<', timestamp),
          expression.and([
            expression('created_at', '=', timestamp),
            expression('conversation_id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('conversation_id', 'desc')
      .limit(filter.limit + 1)
      .execute();
    const page = rows.slice(0, filter.limit);
    const participants = await this.participantsFor(
      scope,
      page.map(({ conversation_id }) => conversation_id),
    );
    const data = page.map((row) =>
      mapConversation(row, participants.get(row.conversation_id) ?? []),
    );
    const tail = page.at(-1);
    return {
      data,
      pagination:
        rows.length > filter.limit && tail
          ? {
              hasMore: true,
              nextCursor: encodeTimeCursor('conversation', tail.created_at, tail.conversation_id),
            }
          : { hasMore: false },
    };
  }

  async getConversation(scope: AdminScope, conversationId: string): Promise<Conversation> {
    const row = await this.scopedConversation(scope, conversationId);
    const participants = await this.participantsFor(scope, [conversationId]);
    return mapConversation(row, participants.get(conversationId) ?? []);
  }

  async listMessages(
    scope: AdminScope,
    conversationId: string,
    request: { cursor?: string; limit: number },
  ): Promise<AdminMessageList> {
    await this.scopedConversation(scope, conversationId);
    const cursor = request.cursor ? decodeSequenceCursor('message', request.cursor) : undefined;
    if (request.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('messages')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', '=', conversationId);
    if (cursor) query = query.where('sequence', '>', cursor);
    const rows = await query
      .orderBy('sequence')
      .limit(request.limit + 1)
      .execute();
    const page = rows.slice(0, request.limit);
    const tail = page.at(-1);
    return {
      data: page.map(mapMessage),
      pagination:
        rows.length > request.limit && tail
          ? { hasMore: true, nextCursor: encodeSequenceCursor('message', tail.sequence) }
          : { hasMore: false },
    };
  }

  async listEvents(
    scope: AdminScope,
    conversationId: string,
    request: { cursor?: string; limit: number },
  ): Promise<AdminEventList> {
    await this.scopedConversation(scope, conversationId);
    const cursor = request.cursor ? decodeSequenceCursor('event', request.cursor) : undefined;
    if (request.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('conversation_events')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', '=', conversationId);
    if (!scope.scopes.includes('admin:internal')) {
      query = query.where('visibility', 'in', ['public', 'operator']);
    }
    if (cursor) query = query.where('sequence', '>', cursor);
    const rows = await query
      .orderBy('sequence')
      .limit(request.limit + 1)
      .execute();
    const page = rows.slice(0, request.limit);
    const tail = page.at(-1);
    return {
      data: page.map(mapEvent),
      pagination:
        rows.length > request.limit && tail
          ? { hasMore: true, nextCursor: encodeSequenceCursor('event', tail.sequence) }
          : { hasMore: false },
    };
  }

  private validateFilter(scope: AdminScope, filter: AdminConversationFilter): void {
    if (filter.siteId && !scope.siteIds.includes(filter.siteId)) {
      throw new AdminApiError('FORBIDDEN_SITE', 403, 'The token does not allow this site.');
    }
    if (
      filter.createdAfter &&
      filter.createdBefore &&
      Date.parse(filter.createdAfter) >= Date.parse(filter.createdBefore)
    ) {
      throw new AdminApiError(
        'INVALID_DATE_RANGE',
        400,
        'createdAfter must be earlier than createdBefore.',
      );
    }
  }

  private async scopedConversation(scope: AdminScope, conversationId: string) {
    const row = await this.database
      .selectFrom('conversations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', '=', conversationId)
      .executeTakeFirst();
    if (!row) throw new AdminApiError('NOT_FOUND', 404, 'The resource was not found.');
    return row;
  }

  private async participantsFor(scope: AdminScope, conversationIds: string[]) {
    const grouped = new Map<string, Selectable<ConversationParticipantTable>[]>();
    if (conversationIds.length === 0) return grouped;
    const rows = await this.database
      .selectFrom('conversation_participants')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', 'in', conversationIds)
      .orderBy('created_at')
      .execute();
    for (const row of rows) {
      const group = grouped.get(row.conversation_id) ?? [];
      group.push(row);
      grouped.set(row.conversation_id, group);
    }
    return grouped;
  }

  private invalidCursor() {
    return new AdminApiError('INVALID_CURSOR', 400, 'The cursor is invalid.');
  }
}

function mapConversation(
  row: Selectable<ConversationTable>,
  participants: Selectable<ConversationParticipantTable>[],
): Conversation {
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    principalId: row.principal_id,
    agentRef: row.agent_ref,
    status: row.status,
    participants: participants.map((participant) =>
      participant.kind === 'user'
        ? {
            participantId: participant.participant_id,
            kind: 'user',
            principalId: participant.principal_id as string,
          }
        : {
            participantId: participant.participant_id,
            kind: 'agent',
            agentRef: participant.agent_ref as string,
          },
    ),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMessage(row: Selectable<MessageTable>): Message {
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

function mapEvent(row: Selectable<ConversationEventTable>): ConversationEvent {
  return {
    eventId: row.event_id,
    sequence: row.sequence,
    type: row.type,
    occurredAt: row.occurred_at.toISOString(),
    visibility: row.visibility,
    conversationId: row.conversation_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    data: row.data,
  } as ConversationEvent;
}
