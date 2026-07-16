import type {
  Conversation,
  Message,
  PublicConversationEvent,
  SessionBootstrapResponse,
} from '@formation-chat-core/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  createChatClient,
  createMemoryStorage,
  type ChatTransport,
  type StreamEventsRequest,
} from '../src/index.js';

const conversation: Conversation = {
  conversationId: 'conversation-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  principalId: 'principal-1',
  agentRef: 'agent-1',
  status: 'active',
  participants: [
    { participantId: 'user-1', kind: 'user', principalId: 'principal-1' },
    { participantId: 'agent-1', kind: 'agent', agentRef: 'agent-1' },
  ],
  createdAt: '2026-07-15T10:00:00.000Z',
  updatedAt: '2026-07-15T10:00:00.000Z',
};

const bootstrap: SessionBootstrapResponse = {
  accessToken: 'memory-only-token',
  tokenType: 'Bearer',
  expiresAt: '2026-07-15T11:00:00.000Z',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  principal: { kind: 'anonymous', principalId: 'principal-1' },
  sessionId: 'session-1',
  browserIdentity: 'browser-1',
};

class FakeTransport implements ChatTransport {
  readonly bootstrap = vi.fn(async () => bootstrap);
  readonly createConversation = vi.fn(async () => conversation);
  readonly getConversation = vi.fn(async () => conversation);
  readonly listMessages = vi.fn(async () => this.messages);
  readonly submitMessage = vi.fn(async () => this.messages[0] as Message);
  readonly submitStructuredInput = vi.fn(async (_conversationId, requestId) => ({
    requestId,
    conversationId: conversation.conversationId,
    runId: 'run-1',
    inputKind: 'email' as const,
    purpose: 'handoff_email_delivery' as const,
    prompt: 'Where can we reach you?',
    required: false,
    status: 'submitted' as const,
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:01:00.000Z',
  }));
  readonly cancel = vi.fn(async () => ({
    conversationId: conversation.conversationId,
    runId: 'run-1',
    cancellationStatus: 'cancelled' as const,
  }));
  readonly retry = vi.fn(async () => undefined);
  readonly streams = new Set<StreamEventsRequest>();
  messages: Message[] = [];

  async streamEvents(request: StreamEventsRequest): Promise<void> {
    this.streams.add(request);
    await new Promise<void>((resolve) =>
      request.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    this.streams.delete(request);
  }

  async emit(event: PublicConversationEvent): Promise<void> {
    await Promise.all([...this.streams].map(({ onEvent }) => onEvent(event)));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('framework-neutral chat client', () => {
  it('resumes browser identity and selected conversation after refresh', async () => {
    const storage = createMemoryStorage();
    await storage.save('site-key', {
      version: 1,
      browserIdentity: 'browser-1',
      conversationId: 'conversation-1',
      lastEventId: 'event-4',
      lastEventSequence: 4,
    });
    const transport = new FakeTransport();
    const client = createChatClient({ siteKey: 'site-key', storage, transport });
    await client.start();

    expect(transport.bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ browserIdentity: 'browser-1' }),
    );
    expect(client.getState().conversation?.conversationId).toBe('conversation-1');
    expect([...transport.streams][0]?.lastEventId).toBe('event-4');
    expect(JSON.stringify(await storage.load('site-key'))).not.toContain('memory-only-token');
    client.destroy();
  });

  it('automatically replaces state and reconnects without an expired cursor on sync.required', async () => {
    const storage = createMemoryStorage();
    await storage.save('site-key', {
      version: 1,
      browserIdentity: 'browser-1',
      conversationId: 'conversation-1',
      lastEventId: 'expired',
    });
    const transport = new FakeTransport();
    const client = createChatClient({ siteKey: 'site-key', storage, transport });
    await client.start();
    await transport.emit({
      eventId: 'sync-1',
      sequence: 8,
      type: 'sync.required',
      visibility: 'public',
      occurredAt: '2026-07-15T10:05:00.000Z',
      conversationId: 'conversation-1',
      data: { reason: 'retention_window_exceeded' },
    });
    await tick();

    expect(transport.listMessages).toHaveBeenCalledTimes(2);
    expect([...transport.streams][0]?.lastEventId).toBeUndefined();
    expect((await storage.load('site-key'))?.lastEventId).toBeUndefined();
    client.destroy();
  });

  it('converges another tab through canonical snapshot order', async () => {
    const storage = createMemoryStorage();
    const transport = new FakeTransport();
    const first = createChatClient({ siteKey: 'site-key', storage, transport });
    const second = createChatClient({ siteKey: 'site-key', storage, transport });
    await first.start();
    await first.createConversation();
    await second.start();
    transport.messages = [
      {
        messageId: 'message-2',
        conversationId: 'conversation-1',
        sequence: 2,
        participantId: 'agent-1',
        role: 'assistant',
        status: 'completed',
        parts: [{ type: 'text', text: 'Answer' }],
        createdAt: '2026-07-15T10:00:02.000Z',
        completedAt: '2026-07-15T10:00:02.000Z',
      },
    ];
    await transport.emit({
      eventId: 'event-complete',
      sequence: 2,
      type: 'message.completed',
      visibility: 'public',
      occurredAt: '2026-07-15T10:00:02.000Z',
      conversationId: 'conversation-1',
      runId: 'run-1',
      messageId: 'message-2',
      data: { parts: [{ type: 'text', text: 'Answer' }] },
    });
    await tick();

    expect(second.getState().messages.map(({ messageId }) => messageId)).toEqual(['message-2']);
    first.destroy();
    second.destroy();
  });

  it('submits active structured input without retaining the email in state', async () => {
    const transport = new FakeTransport();
    const client = createChatClient({
      siteKey: 'site-key',
      transport,
      createId: () => 'input-key',
    });
    await client.start();
    await client.createConversation();
    await transport.emit({
      eventId: 'contact-1',
      sequence: 1,
      type: 'contact.requested',
      visibility: 'public',
      occurredAt: '2026-07-15T10:00:00.000Z',
      conversationId: 'conversation-1',
      runId: 'run-1',
      data: {
        requestId: 'request-1',
        inputKind: 'email',
        purpose: 'handoff_email_delivery',
        prompt: 'Where can we reach you?',
        required: false,
      },
    });
    await client.submitStructuredInput('request-1', {
      value: 'visitor@example.com',
      consent: true,
    });

    expect(transport.submitStructuredInput).toHaveBeenCalledWith(
      'conversation-1',
      'request-1',
      { value: 'visitor@example.com', consent: true },
      'input-key',
    );
    expect(client.getState().contactRequest).toBeUndefined();
    expect(JSON.stringify(client.getState())).not.toContain('visitor@example.com');
    client.destroy();
  });
});
