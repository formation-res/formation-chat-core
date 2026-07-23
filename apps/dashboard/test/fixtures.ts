import type {
  AdminConversationList,
  AdminEventList,
  AdminHandoffList,
  AdminMessageList,
  AdminOverview,
  AdminRunList,
  Conversation,
} from '@formation-chat-core/protocol';

export const conversation: Conversation = {
  conversationId: 'conversation-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  principalId: 'principal-1',
  agentRef: 'support-agent',
  status: 'active',
  participants: [
    { participantId: 'visitor-1', kind: 'user', principalId: 'principal-1' },
    { participantId: 'agent-1', kind: 'agent', agentRef: 'support-agent' },
  ],
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:02:00.000Z',
};

export const conversationPage: AdminConversationList = {
  data: [conversation],
  pagination: { hasMore: false },
};

export const overview: AdminOverview = {
  tenant: { tenantId: 'tenant-1', displayName: 'Tenant One' },
  totals: {
    conversations: 3,
    activeConversations: 2,
    runs: 4,
    failures: 1,
    handoffs: 1,
  },
  sites: [
    {
      siteId: 'site-1',
      displayName: 'Main website',
      siteKey: 'site-1-key',
      allowedOrigins: ['https://www.example.com'],
      agentRef: 'support-agent',
      widgets: [
        {
          widgetId: 'widget-1',
          widgetKey: 'main-chat',
          displayName: 'Main chat',
          version: '2026-07-23',
          theme: 'earth',
          launcher: 'agent',
          placement: 'bottom-right',
          defaultAgentAlias: 'support',
          agentAliases: [
            { alias: 'support', label: 'Support', agentRef: 'support-agent' },
            { alias: 'sales', label: 'Sales', agentRef: 'sales-agent' },
          ],
          createdAt: '2026-07-16T09:00:00.000Z',
          updatedAt: '2026-07-16T09:00:00.000Z',
        },
      ],
      stats: {
        conversations: 1,
        activeConversations: 1,
        runs: 1,
        failures: 0,
        handoffs: 0,
      },
      recentActivityAt: '2026-07-16T10:02:00.000Z',
    },
    {
      siteId: 'site-2',
      displayName: 'Docs',
      siteKey: 'site-2-key',
      allowedOrigins: ['https://docs.example.com'],
      agentRef: 'docs-agent',
      widgets: [],
      stats: {
        conversations: 2,
        activeConversations: 1,
        runs: 3,
        failures: 1,
        handoffs: 1,
      },
      recentActivityAt: '2026-07-16T09:30:00.000Z',
    },
  ],
};

export const messagePage: AdminMessageList = {
  data: [
    {
      messageId: 'message-1',
      conversationId: conversation.conversationId,
      sequence: 1,
      participantId: 'visitor-1',
      role: 'user',
      status: 'completed',
      parts: [{ type: 'text', text: 'How can I change my plan?' }],
      createdAt: '2026-07-16T10:00:00.000Z',
      completedAt: '2026-07-16T10:00:00.000Z',
    },
    {
      messageId: 'message-2',
      conversationId: conversation.conversationId,
      sequence: 2,
      participantId: 'agent-1',
      role: 'assistant',
      status: 'completed',
      parts: [{ type: 'text', text: 'I can help with that.' }],
      createdAt: '2026-07-16T10:01:00.000Z',
      completedAt: '2026-07-16T10:01:01.000Z',
    },
  ],
  pagination: { hasMore: false },
};

export const eventPage: AdminEventList = {
  data: [
    {
      eventId: 'event-1',
      sequence: 1,
      type: 'run.started',
      visibility: 'public',
      conversationId: conversation.conversationId,
      runId: 'run-1',
      occurredAt: '2026-07-16T10:00:01.000Z',
      data: { agentRef: 'support-agent' },
    },
    {
      eventId: 'event-2',
      sequence: 2,
      type: 'tool.started',
      visibility: 'internal',
      conversationId: conversation.conversationId,
      runId: 'run-1',
      messageId: 'message-2',
      occurredAt: '2026-07-16T10:00:02.000Z',
      data: { toolCallId: 'tool-1', label: 'Account lookup' },
    },
  ],
  pagination: { hasMore: false },
};

export const runPage: AdminRunList = {
  data: [
    {
      runId: 'run-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      conversationId: conversation.conversationId,
      userMessageId: 'message-1',
      assistantMessageId: 'message-2',
      agentRef: 'support-agent',
      status: 'completed',
      attempt: 1,
      createdAt: '2026-07-16T10:00:01.000Z',
      updatedAt: '2026-07-16T10:01:01.000Z',
      completedAt: '2026-07-16T10:01:01.000Z',
    },
  ],
  pagination: { hasMore: false },
};

export const handoffPage: AdminHandoffList = {
  data: [
    {
      handoffId: 'handoff-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      conversationId: conversation.conversationId,
      runId: 'run-1',
      status: 'awaiting_contact',
      createdAt: '2026-07-16T10:01:30.000Z',
      updatedAt: '2026-07-16T10:01:30.000Z',
    },
  ],
  pagination: { hasMore: false },
};
