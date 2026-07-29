import {
  createAnalytics,
  type AnalyticsClient,
  type AnalyticsError,
} from '@tryformation/formation-web-analytics-client';
import type { ChatState } from '@formation-chat-core/browser-client';

export interface WidgetAnalyticsConfiguration {
  endpoint: string;
  siteId: string;
  widgetId: string;
  agentAlias: string;
  widgetVersion: string;
}

interface ReporterContext {
  websiteId: string;
  widgetId: string;
  agentAlias: string;
  widgetVersion: string;
}

export interface WidgetAnalyticsReporter {
  sessionStarted(state: ChatState): void;
  observe(state: ChatState): void;
  conversationStarted(conversationId: string, state: ChatState): void;
  messageSent(state: ChatState): void;
}

export function createWidgetAnalytics(
  configuration: WidgetAnalyticsConfiguration,
): WidgetAnalyticsReporter {
  const analytics = createAnalytics({
    endpoint: configuration.endpoint,
    siteId: configuration.siteId,
    autoPageviews: false,
    onError: (error: AnalyticsError) => logAnalyticsError(error),
  });
  return createWidgetAnalyticsReporter(analytics, {
    websiteId: configuration.siteId,
    widgetId: configuration.widgetId,
    agentAlias: configuration.agentAlias,
    widgetVersion: configuration.widgetVersion,
  });
}

export function createWidgetAnalyticsReporter(
  analytics: AnalyticsClient,
  context: ReporterContext,
): WidgetAnalyticsReporter {
  let observedConversationId: string | undefined;
  let observedMessageCount = 0;
  let observedHandoff: string | undefined;

  reportAnalytics(() =>
    analytics.setContext({
      website_id: context.websiteId,
      widget_id: context.widgetId,
      agent_alias: context.agentAlias,
      widget_version: context.widgetVersion,
    }),
  );

  return {
    sessionStarted(state) {
      const session = state.session;
      if (!session) return;
      reportAnalytics(() =>
        analytics.event('chat_session_started', {
          ...messageCounts(state),
        }),
      );
    },
    observe(state) {
      const counts = messageCounts(state);
      const conversationId = state.conversation?.conversationId;
      if (conversationId !== observedConversationId) {
        observedConversationId = conversationId;
        observedMessageCount = counts.message_count;
        observedHandoff = undefined;
      } else if (conversationId && counts.message_count !== observedMessageCount) {
        observedMessageCount = counts.message_count;
        reportAnalytics(() =>
          analytics.event('chat_conversation_length', {
            ...counts,
          }),
        );
      }

      const handoff = state.handoff;
      const handoffKey = handoff ? `${handoff.handoffId}:${handoff.status}` : undefined;
      if (handoff && handoffKey !== observedHandoff) {
        observedHandoff = handoffKey;
        reportAnalytics(() =>
          analytics.event(
            handoff.status === 'completed' ? 'chat_handoff_completed' : 'chat_handoff_requested',
            {
              ...counts,
            },
          ),
        );
      }
    },
    conversationStarted(conversationId, state) {
      const counts = messageCounts(state);
      observedConversationId = conversationId;
      observedMessageCount = counts.message_count;
      observedHandoff = undefined;
      reportAnalytics(() =>
        analytics.event('chat_conversation_started', {
          ...counts,
        }),
      );
    },
    messageSent(state) {
      reportAnalytics(() =>
        analytics.event('chat_message_sent', {
          ...messageCounts(state),
        }),
      );
    },
  };
}

function reportAnalytics(action: () => void): void {
  try {
    action();
  } catch (error) {
    logAnalyticsError(error);
  }
}

function logAnalyticsError(error: unknown): void {
  if (typeof console === 'undefined') return;
  console.warn('[formation-chat-widget] analytics unavailable', error);
}

function messageCounts(state: ChatState) {
  const messages = new Map(
    state.messages.map((message) => [message.messageId, message.role] as const),
  );
  for (const message of Object.values(state.liveMessages)) {
    if (message.status === 'completed' && !messages.has(message.messageId)) {
      messages.set(message.messageId, 'assistant');
    }
  }
  const roles = [...messages.values()];
  return {
    message_count: roles.length,
    user_message_count: roles.filter((role) => role === 'user').length,
    assistant_message_count: roles.filter((role) => role === 'assistant').length,
  };
}
