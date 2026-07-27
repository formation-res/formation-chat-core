import type { AnalyticsClient } from '@tryformation/formation-web-analytics-client';
import type { ChatState } from '@formation-chat-core/browser-client';
import { describe, expect, it, vi } from 'vitest';

import { createWidgetAnalyticsReporter } from '../site/widget-analytics.js';

describe('shared widget analytics', () => {
  it('tracks a chat session and conversation message counts without page views', () => {
    const analytics = fakeAnalytics();
    const reporter = createWidgetAnalyticsReporter(analytics, {
      websiteId: 'askmailfront',
      widgetId: 'main-chat',
      agentAlias: 'support',
      widgetVersion: '2026-07-27',
    });

    reporter.sessionStarted(chatState());
    reporter.conversationStarted('conversation-1', chatState());
    reporter.observe(
      chatState({
        conversation: conversation(),
        messages: [message('user-1', 'user')],
      }),
    );
    reporter.messageSent(
      chatState({
        conversation: conversation(),
        messages: [message('user-1', 'user')],
      }),
    );
    reporter.observe(
      chatState({
        conversation: conversation(),
        messages: [message('user-1', 'user')],
        liveMessages: {
          'assistant-1': {
            messageId: 'assistant-1',
            status: 'completed',
            text: 'Done',
            parts: [{ type: 'text', text: 'Done' }],
          },
        },
      }),
    );

    expect(analytics.page).not.toHaveBeenCalled();
    expect(analytics.setContext).toHaveBeenCalledWith({
      website_id: 'askmailfront',
      widget_id: 'main-chat',
      agent_alias: 'support',
      widget_version: '2026-07-27',
    });
    expect(analytics.event.mock.calls).toEqual([
      ['chat_session_started', expect.objectContaining({ message_count: 0 })],
      ['chat_conversation_started', expect.objectContaining({ message_count: 0 })],
      [
        'chat_conversation_length',
        expect.objectContaining({
          message_count: 1,
          user_message_count: 1,
          assistant_message_count: 0,
        }),
      ],
      [
        'chat_message_sent',
        expect.objectContaining({
          message_count: 1,
          user_message_count: 1,
        }),
      ],
      [
        'chat_conversation_length',
        expect.objectContaining({
          message_count: 2,
          assistant_message_count: 1,
        }),
      ],
    ]);
    expect(JSON.stringify(analytics.event.mock.calls)).not.toMatch(
      /session-1|conversation-1|handoff-1/,
    );
  });

  it('tracks each handoff state once with the current conversation length', () => {
    const analytics = fakeAnalytics();
    const reporter = createWidgetAnalyticsReporter(analytics, {
      websiteId: 'askmailfront',
      widgetId: 'main-chat',
      agentAlias: 'support',
      widgetVersion: '2026-07-27',
    });
    const requested = chatState({
      conversation: conversation(),
      messages: [message('user-1', 'user'), message('assistant-1', 'assistant')],
      handoff: { handoffId: 'handoff-1', status: 'requested' },
    });
    const completed = {
      ...requested,
      handoff: { handoffId: 'handoff-1', status: 'completed' as const },
    };

    reporter.sessionStarted(requested);
    reporter.observe(requested);
    reporter.observe(requested);
    reporter.observe(completed);

    expect(analytics.event.mock.calls).toEqual([
      ['chat_session_started', expect.objectContaining({ message_count: 2 })],
      ['chat_handoff_requested', expect.objectContaining({ message_count: 2 })],
      ['chat_handoff_completed', expect.objectContaining({ message_count: 2 })],
    ]);
    expect(JSON.stringify(analytics.event.mock.calls)).not.toMatch(
      /session-1|conversation-1|handoff-1/,
    );
  });
});

function fakeAnalytics() {
  return {
    page: vi.fn(),
    event: vi.fn(),
    identify: vi.fn(),
    setContext: vi.fn(),
  } satisfies AnalyticsClient;
}

function chatState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    phase: 'ready',
    session: {
      tenantId: 'tenant-1',
      siteId: 'site-1',
      principal: { kind: 'anonymous', principalId: 'principal-1' },
      sessionId: 'session-1',
      expiresAt: '2026-07-27T12:00:00.000Z',
    },
    messages: [],
    liveMessages: {},
    lastEventSequence: 0,
    recentEventIds: [],
    ...overrides,
  };
}

function conversation() {
  return {
    conversationId: 'conversation-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    principalId: 'principal-1',
    agentRef: 'support',
    status: 'active' as const,
    participants: [
      { participantId: 'user', kind: 'user' as const, principalId: 'principal-1' },
      { participantId: 'agent', kind: 'agent' as const, agentRef: 'support' },
    ],
    createdAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
  };
}

function message(messageId: string, role: 'user' | 'assistant') {
  return {
    messageId,
    conversationId: 'conversation-1',
    sequence: role === 'user' ? 1 : 2,
    participantId: role,
    role,
    status: 'completed' as const,
    parts: [{ type: 'text' as const, text: 'Hello' }],
    createdAt: '2026-07-27T10:00:00.000Z',
    completedAt: '2026-07-27T10:00:01.000Z',
  };
}
