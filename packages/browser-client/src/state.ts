import type { ContentPart, Message, PublicConversationEvent } from '@formation-chat-core/protocol';

import type { ChatState, ChatStateAction, LiveMessage } from './types.js';

export const initialChatState: ChatState = {
  phase: 'idle',
  messages: [],
  liveMessages: {},
  lastEventSequence: 0,
  recentEventIds: [],
};

export function reduceChatState(state: ChatState, action: ChatStateAction): ChatState {
  switch (action.type) {
    case 'phase.changed':
      return withoutError({ ...state, phase: action.phase });
    case 'session.loaded':
      return withoutError({ ...state, session: action.session, phase: 'ready' });
    case 'snapshot.loaded': {
      const messages = canonicalMessages(action.messages);
      const canonicalIds = new Set(messages.map(({ messageId }) => messageId));
      const snapshot = {
        ...state,
        conversation: action.conversation,
        messages,
        liveMessages: Object.fromEntries(
          Object.entries(state.liveMessages).filter(([messageId]) => !canonicalIds.has(messageId)),
        ),
        phase: state.run?.status === 'failed' ? ('error' as const) : ('ready' as const),
      };
      return state.run?.status === 'failed' ? snapshot : withoutError(snapshot);
    }
    case 'conversation.cleared':
      return withoutError({
        ...withoutRun(withoutCursor(withoutConversation(state))),
        messages: [],
        liveMessages: {},
        lastEventSequence: 0,
        recentEventIds: [],
        phase: 'ready',
      });
    case 'live.cleared':
      return { ...state, liveMessages: {} };
    case 'message.submitted':
      return {
        ...state,
        messages: canonicalMessages([...state.messages, action.message]),
        run: { status: 'queued' },
      };
    case 'run.cancelled':
      return {
        ...state,
        run: {
          runId: action.runId,
          status: action.requested ? 'cancel_requested' : 'cancelled',
        },
      };
    case 'run.retrying':
      return withoutError({ ...state, phase: 'streaming', run: { status: 'queued' } });
    case 'cursor.cleared':
      return { ...withoutCursor(state), lastEventSequence: 0, recentEventIds: [] };
    case 'cursor.restored':
      return { ...state, lastEventId: action.eventId, lastEventSequence: action.sequence };
    case 'connection.failed':
      return { ...state, phase: 'reconnecting', error: action.error };
    case 'error.raised':
      return { ...state, phase: 'error', error: action.error };
    case 'event.received':
      return receiveEvent(state, action.event);
  }
}

function receiveEvent(state: ChatState, event: PublicConversationEvent): ChatState {
  if (state.recentEventIds.includes(event.eventId)) return state;
  if (event.type === 'sync.required') return state;

  const recentEventIds = [...state.recentEventIds, event.eventId].slice(-100);
  let next: ChatState = {
    ...state,
    phase: 'streaming' as const,
    lastEventId: event.eventId,
    lastEventSequence: Math.max(state.lastEventSequence, event.sequence),
    recentEventIds,
  };
  if (event.type === 'run.started') {
    next = { ...withoutError(next), run: { runId: event.runId, status: 'running' } };
  } else if (event.type === 'run.completed') {
    next = {
      ...withoutError(next),
      phase: 'ready',
      run: { runId: event.runId, status: 'completed' },
    };
  } else if (event.type === 'run.failed') {
    next = {
      ...next,
      phase: 'error',
      run: { runId: event.runId, status: 'failed', failureCode: event.data.code },
      error: { code: event.data.code, message: 'The agent run failed.', retryable: true },
    };
  }
  const messageId = event.messageId;
  if (!messageId || state.messages.some((message) => message.messageId === messageId)) return next;

  const current = state.liveMessages[messageId] ?? liveMessage(messageId);
  let updated = current;
  switch (event.type) {
    case 'message.started':
      break;
    case 'message.delta':
      updated = { ...current, text: current.text + event.data.delta };
      break;
    case 'message.completed':
      updated = {
        ...current,
        status: 'completed',
        parts: event.data.parts,
        text: textFromParts(event.data.parts) || current.text,
      };
      break;
    case 'tool.started':
      updated = {
        ...current,
        parts: upsertTool(current.parts, event.data.toolCallId, event.data.label, 'started'),
      };
      break;
    case 'tool.completed':
    case 'tool.failed':
      updated = {
        ...current,
        parts: updateTool(
          current.parts,
          event.data.toolCallId,
          event.type === 'tool.completed' ? 'completed' : 'failed',
        ),
      };
      break;
    case 'citation.added':
      updated = { ...current, parts: [...current.parts, { type: 'citation', ...event.data }] };
      break;
  }
  return { ...next, liveMessages: { ...state.liveMessages, [messageId]: updated } };
}

function canonicalMessages(messages: readonly Message[]): Message[] {
  const byId = new Map(messages.map((message) => [message.messageId, message]));
  return [...byId.values()].sort(
    (left, right) =>
      left.sequence - right.sequence || left.messageId.localeCompare(right.messageId),
  );
}

function liveMessage(messageId: string): LiveMessage {
  return { messageId, status: 'streaming', text: '', parts: [] };
}

function textFromParts(parts: readonly ContentPart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function upsertTool(
  parts: readonly ContentPart[],
  toolCallId: string,
  label: string,
  status: 'started' | 'completed' | 'failed',
): ContentPart[] {
  const remaining = parts.filter(
    (part) => part.type !== 'tool_status' || part.toolCallId !== toolCallId,
  );
  return [...remaining, { type: 'tool_status', toolCallId, label, status }];
}

function updateTool(
  parts: readonly ContentPart[],
  toolCallId: string,
  status: 'completed' | 'failed',
): ContentPart[] {
  return parts.map((part) =>
    part.type === 'tool_status' && part.toolCallId === toolCallId ? { ...part, status } : part,
  );
}

function withoutError(state: ChatState): ChatState {
  const rest = { ...state };
  delete rest.error;
  return rest;
}

function withoutConversation(state: ChatState): ChatState {
  const rest = { ...state };
  delete rest.conversation;
  return rest;
}

function withoutCursor(state: ChatState): ChatState {
  const rest = { ...state };
  delete rest.lastEventId;
  return rest;
}

function withoutRun(state: ChatState): ChatState {
  const rest = { ...state };
  delete rest.run;
  return rest;
}
