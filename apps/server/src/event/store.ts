import { randomUUID } from 'node:crypto';

import type {
  ConnectorEvent,
  ConversationEvent,
  PublicConversationEvent,
  SessionTokenClaims,
} from '@formation-chat-core/protocol';
import { sql, type Selectable } from 'kysely';

import type { Database } from '../database/database.js';
import type { ConversationEventTable } from '../database/types.js';

type EventScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'principalId'>;
type StoredEvent = Selectable<ConversationEventTable>;

export type EventReplay =
  | { kind: 'events'; events: PublicConversationEvent[] }
  | { kind: 'sync-required'; event: PublicConversationEvent };

export class EventApiError extends Error {
  constructor(
    readonly code: 'CONVERSATION_NOT_FOUND',
    readonly statusCode: 404,
  ) {
    super('The conversation was not found.');
    this.name = 'EventApiError';
  }
}

export class EventStore {
  private readonly retentionMaxEvents: number;

  constructor(
    private readonly database: Database,
    options: { retentionMaxEvents: number },
  ) {
    if (!Number.isSafeInteger(options.retentionMaxEvents) || options.retentionMaxEvents < 1) {
      throw new RangeError('retentionMaxEvents must be a positive safe integer.');
    }
    this.retentionMaxEvents = options.retentionMaxEvents;
  }

  async append(scope: EventScope, event: ConnectorEvent): Promise<ConversationEvent> {
    return this.database.transaction().execute(async (transaction) => {
      const allocation = await transaction
        .updateTable('conversations')
        .set({ next_event_sequence: sql<number>`next_event_sequence + 1` })
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('conversation_id', '=', event.conversationId)
        .returning('next_event_sequence')
        .executeTakeFirst();
      if (!allocation) throw new EventApiError('CONVERSATION_NOT_FOUND', 404);

      const sequence = allocation.next_event_sequence - 1;
      const eventId = randomUUID();
      const occurredAt = new Date();
      await transaction
        .insertInto('conversation_events')
        .values({
          event_id: eventId,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          conversation_id: event.conversationId,
          sequence,
          type: event.type,
          visibility: event.visibility,
          run_id: event.runId,
          message_id: event.messageId ?? null,
          data: JSON.stringify(event.data),
          occurred_at: occurredAt,
        })
        .execute();
      await transaction
        .deleteFrom('conversation_events')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('conversation_id', '=', event.conversationId)
        .where('sequence', '<=', sequence - this.retentionMaxEvents)
        .execute();

      return {
        ...event,
        eventId,
        sequence,
        occurredAt: occurredAt.toISOString(),
      };
    });
  }

  async replay(
    scope: EventScope,
    conversationId: string,
    afterEventId?: string,
  ): Promise<EventReplay> {
    const conversation = await this.database
      .selectFrom('conversations')
      .select('next_event_sequence')
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('principal_id', '=', scope.principalId)
      .where('conversation_id', '=', conversationId)
      .executeTakeFirst();
    if (!conversation) throw new EventApiError('CONVERSATION_NOT_FOUND', 404);

    let afterSequence = 0;
    if (afterEventId) {
      const cursor = await this.database
        .selectFrom('conversation_events')
        .select('sequence')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('conversation_id', '=', conversationId)
        .where('visibility', '=', 'public')
        .where('event_id', '=', afterEventId)
        .executeTakeFirst();
      if (!cursor) {
        return {
          kind: 'sync-required',
          event: {
            eventId: randomUUID(),
            sequence: Math.max(1, conversation.next_event_sequence - 1),
            type: 'sync.required',
            occurredAt: new Date().toISOString(),
            visibility: 'public',
            conversationId,
            data: { reason: 'retention_window_exceeded' },
          },
        };
      }
      afterSequence = cursor.sequence;
    }

    const rows = await this.database
      .selectFrom('conversation_events')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('conversation_id', '=', conversationId)
      .where('visibility', '=', 'public')
      .where('sequence', '>', afterSequence)
      .orderBy('sequence', 'asc')
      .execute();
    return { kind: 'events', events: rows.map((row) => toConversationEvent(row)) };
  }
}

function toConversationEvent(row: StoredEvent): PublicConversationEvent {
  return {
    eventId: row.event_id,
    sequence: row.sequence,
    type: row.type,
    occurredAt: row.occurred_at.toISOString(),
    visibility: 'public',
    conversationId: row.conversation_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    data: row.data,
  } as PublicConversationEvent;
}
