import type { PublicConversationEvent } from '@formation-chat-core/protocol';

export type EventBrokerNotification =
  { kind: 'event'; event: PublicConversationEvent } | { kind: 'overflow' } | { kind: 'closed' };

export interface EventSubscription {
  next(): Promise<EventBrokerNotification>;
  close(): void;
}

class BufferedSubscription implements EventSubscription {
  private queue: EventBrokerNotification[] = [];
  private waiter: ((notification: EventBrokerNotification) => void) | undefined;
  private terminal = false;

  constructor(
    private readonly bufferSize: number,
    private readonly detach: () => void,
  ) {}

  push(event: PublicConversationEvent): void {
    if (this.terminal) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ kind: 'event', event });
      return;
    }
    if (this.queue.length < this.bufferSize) {
      this.queue.push({ kind: 'event', event });
      return;
    }
    this.queue = [{ kind: 'overflow' }];
    this.terminal = true;
    this.detach();
  }

  next(): Promise<EventBrokerNotification> {
    const notification = this.queue.shift();
    if (notification) return Promise.resolve(notification);
    if (this.terminal) return Promise.resolve({ kind: 'closed' });
    if (this.waiter) throw new Error('Only one pending subscription read is supported.');
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  close(): void {
    if (this.terminal && !this.waiter) return;
    this.terminal = true;
    this.queue = [];
    this.detach();
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ kind: 'closed' });
    }
  }
}

export class EventBroker {
  private readonly subscriberBufferSize: number;
  private readonly subscriptions = new Map<string, Set<BufferedSubscription>>();

  constructor(options: { subscriberBufferSize: number }) {
    if (!Number.isSafeInteger(options.subscriberBufferSize) || options.subscriberBufferSize < 1) {
      throw new RangeError('subscriberBufferSize must be a positive safe integer.');
    }
    this.subscriberBufferSize = options.subscriberBufferSize;
  }

  subscribe(conversationId: string): EventSubscription {
    const subscriptions = this.subscriptions.get(conversationId) ?? new Set();
    const subscription = new BufferedSubscription(this.subscriberBufferSize, () => {
      subscriptions.delete(subscription);
      if (subscriptions.size === 0) this.subscriptions.delete(conversationId);
    });
    subscriptions.add(subscription);
    this.subscriptions.set(conversationId, subscriptions);
    return subscription;
  }

  publish(event: PublicConversationEvent): void {
    for (const subscription of this.subscriptions.get(event.conversationId) ?? []) {
      subscription.push(event);
    }
  }
}
