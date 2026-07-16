import type { Conversation, Message, PublicConversationEvent } from '@formation-chat-core/protocol';
import { describe, expect, it } from 'vitest';

import { initialChatState, reduceChatState } from '../src/index.js';

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

const userMessage: Message = {
  messageId: 'message-user',
  conversationId: 'conversation-1',
  sequence: 1,
  participantId: 'user-1',
  role: 'user',
  status: 'completed',
  parts: [{ type: 'text', text: 'Hello' }],
  createdAt: '2026-07-15T10:00:01.000Z',
  completedAt: '2026-07-15T10:00:01.000Z',
};

const event = (overrides: Partial<PublicConversationEvent>): PublicConversationEvent =>
  ({
    eventId: 'event-1',
    sequence: 1,
    type: 'message.started',
    visibility: 'public',
    occurredAt: '2026-07-15T10:00:02.000Z',
    conversationId: 'conversation-1',
    runId: 'run-1',
    messageId: 'message-assistant',
    data: { role: 'assistant' },
    ...overrides,
  }) as PublicConversationEvent;

describe('chat state reducer', () => {
  it('orders and deduplicates canonical snapshot messages', () => {
    const later = { ...userMessage, messageId: 'message-2', sequence: 2 };
    const state = reduceChatState(initialChatState, {
      type: 'snapshot.loaded',
      conversation,
      messages: [later, userMessage, later],
    });
    expect(state.messages.map(({ messageId }) => messageId)).toEqual(['message-user', 'message-2']);
  });

  it('deduplicates streamed deltas by event id and exposes typed live state', () => {
    let state = reduceChatState(initialChatState, {
      type: 'snapshot.loaded',
      conversation,
      messages: [userMessage],
    });
    state = reduceChatState(state, { type: 'event.received', event: event({}) });
    const delta = event({
      eventId: 'event-2',
      sequence: 2,
      type: 'message.delta',
      data: { delta: 'Hi' },
    });
    state = reduceChatState(state, { type: 'event.received', event: delta });
    state = reduceChatState(state, { type: 'event.received', event: delta });
    expect(state.liveMessages['message-assistant']?.text).toBe('Hi');
    expect(state.lastEventId).toBe('event-2');
  });

  it('does not recreate a live message already present in the canonical snapshot', () => {
    const assistant: Message = {
      ...userMessage,
      messageId: 'message-assistant',
      participantId: 'agent-1',
      sequence: 2,
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done' }],
    };
    let state = reduceChatState(initialChatState, {
      type: 'snapshot.loaded',
      conversation,
      messages: [assistant, userMessage],
    });
    state = reduceChatState(state, { type: 'event.received', event: event({}) });
    expect(state.liveMessages['message-assistant']).toBeUndefined();
  });

  it('exposes a retryable typed failure when an agent run fails', () => {
    const state = reduceChatState(initialChatState, {
      type: 'event.received',
      event: {
        eventId: 'event-failed',
        sequence: 3,
        type: 'run.failed',
        visibility: 'public',
        occurredAt: '2026-07-15T10:00:03.000Z',
        conversationId: 'conversation-1',
        runId: 'run-1',
        data: { code: 'MOCK_FAILURE' },
      },
    });
    expect(state).toMatchObject({
      phase: 'error',
      run: { status: 'failed', failureCode: 'MOCK_FAILURE' },
      error: { code: 'MOCK_FAILURE', retryable: true },
    });
  });

  it('exposes structured contact and handoff state from public events', () => {
    let state = reduceChatState(initialChatState, {
      type: 'event.received',
      event: {
        eventId: 'event-contact',
        sequence: 4,
        type: 'contact.requested',
        visibility: 'public',
        occurredAt: '2026-07-15T10:00:04.000Z',
        conversationId: 'conversation-1',
        runId: 'run-1',
        data: {
          requestId: 'request-1',
          inputKind: 'email',
          purpose: 'handoff_email_delivery',
          prompt: 'Your email',
          required: true,
        },
      },
    });
    expect(state.contactRequest).toMatchObject({ requestId: 'request-1', inputKind: 'email' });

    state = reduceChatState(state, {
      type: 'event.received',
      event: {
        eventId: 'event-handoff',
        sequence: 5,
        type: 'handoff.requested',
        visibility: 'public',
        occurredAt: '2026-07-15T10:00:05.000Z',
        conversationId: 'conversation-1',
        runId: 'run-1',
        data: { handoffId: 'handoff-1' },
      },
    });
    expect(state.handoff).toEqual({ handoffId: 'handoff-1', status: 'requested' });

    state = reduceChatState(state, {
      type: 'event.received',
      event: {
        eventId: 'event-handoff-completed',
        sequence: 6,
        type: 'handoff.completed',
        visibility: 'public',
        occurredAt: '2026-07-15T10:00:06.000Z',
        conversationId: 'conversation-1',
        runId: 'run-1',
        data: { handoffId: 'handoff-1', status: 'completed' },
      },
    });
    expect(state.handoff).toEqual({ handoffId: 'handoff-1', status: 'completed' });

    state = reduceChatState(state, { type: 'conversation.cleared' });
    expect(state.contactRequest).toBeUndefined();
    expect(state.handoff).toBeUndefined();
  });
});
