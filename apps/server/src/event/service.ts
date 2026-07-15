import { randomUUID } from 'node:crypto';

import type {
  ConnectorEvent,
  ConversationEvent,
  PublicConversationEvent,
  SessionTokenClaims,
} from '@formation-chat-core/protocol';

import { EventBroker, type EventSubscription } from './broker.js';
import { EventStore, type EventReplay } from './store.js';

type EventScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'principalId'>;

export class EventService {
  constructor(
    private readonly store: EventStore,
    private readonly broker: EventBroker,
  ) {}

  async append(scope: EventScope, event: ConnectorEvent): Promise<ConversationEvent> {
    const persisted = await this.store.append(scope, event);
    if (persisted.visibility === 'public') {
      this.broker.publish(persisted as PublicConversationEvent);
    }
    return persisted;
  }

  replay(scope: EventScope, conversationId: string, afterEventId?: string): Promise<EventReplay> {
    return this.store.replay(scope, conversationId, afterEventId);
  }

  subscribe(conversationId: string): EventSubscription {
    return this.broker.subscribe(conversationId);
  }

  async syncRequired(scope: EventScope, conversationId: string): Promise<PublicConversationEvent> {
    const replay = await this.store.replay(scope, conversationId, randomUUID());
    if (replay.kind !== 'sync-required') throw new Error('Expected a sync-required replay.');
    return replay.event;
  }
}
