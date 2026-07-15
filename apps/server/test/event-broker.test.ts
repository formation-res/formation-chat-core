import type { PublicConversationEvent } from '@formation-chat-core/protocol';
import { describe, expect, it } from 'vitest';

import { EventBroker } from '../src/event/broker.js';

const event = (sequence: number): PublicConversationEvent => ({
  eventId: `event-${sequence}`,
  sequence,
  type: 'run.started',
  occurredAt: '2026-07-15T12:00:00.000Z',
  visibility: 'public',
  conversationId: 'conversation-1',
  runId: `run-${sequence}`,
  data: { agentRef: 'agent-1' },
});

describe('EventBroker', () => {
  it('fans out an event to concurrent subscribers', async () => {
    const broker = new EventBroker({ subscriberBufferSize: 4 });
    const first = broker.subscribe('conversation-1');
    const second = broker.subscribe('conversation-1');

    broker.publish(event(1));

    await expect(first.next()).resolves.toEqual({ kind: 'event', event: event(1) });
    await expect(second.next()).resolves.toEqual({ kind: 'event', event: event(1) });
    first.close();
    second.close();
  });

  it('marks a slow subscriber for resync without blocking publishers', async () => {
    const broker = new EventBroker({ subscriberBufferSize: 1 });
    const subscription = broker.subscribe('conversation-1');

    broker.publish(event(1));
    broker.publish(event(2));

    await expect(subscription.next()).resolves.toEqual({ kind: 'overflow' });
    await expect(subscription.next()).resolves.toEqual({ kind: 'closed' });
  });

  it('unblocks a pending reader when its subscription closes', async () => {
    const broker = new EventBroker({ subscriberBufferSize: 1 });
    const subscription = broker.subscribe('conversation-1');
    const pending = subscription.next();

    subscription.close();

    await expect(pending).resolves.toEqual({ kind: 'closed' });
  });
});
