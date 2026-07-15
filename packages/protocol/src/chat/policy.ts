import type { ConnectorRunRequest } from './connector.js';
import type { ConnectorEvent } from './events.js';
import type { Conversation, Message } from './resources.js';

export interface ConnectorExecutionContext {
  conversationId: string;
  runId: string;
  agentRef: string;
}

export interface ConnectorRunContext extends ConnectorExecutionContext {
  userParticipantId: string;
  currentMessageId: string;
}

export interface ConnectorEventContext {
  conversationId: string;
  runId: string;
  assistantMessageId: string;
}

/** Enforces trust-context comparisons that portable JSON Schema cannot express. */
export function validateConnectorRunRequestContext(
  request: ConnectorRunRequest,
  expected: ConnectorRunContext,
): boolean {
  const tail = request.history.at(-1);

  return (
    request.conversationId === expected.conversationId &&
    request.runId === expected.runId &&
    request.agentRef === expected.agentRef &&
    request.userParticipantId === expected.userParticipantId &&
    request.currentMessage.messageId === expected.currentMessageId &&
    request.currentMessage.conversationId === expected.conversationId &&
    request.currentMessage.participantId === expected.userParticipantId &&
    tail?.messageId === expected.currentMessageId &&
    request.history.every((message) => message.conversationId === expected.conversationId)
  );
}

export function validateConnectorEventContext(
  event: ConnectorEvent,
  expected: ConnectorEventContext,
): boolean {
  return (
    event.conversationId === expected.conversationId &&
    event.runId === expected.runId &&
    (!('messageId' in event) || event.messageId === expected.assistantMessageId)
  );
}

export function validateConversationParticipantContext(conversation: Conversation): boolean {
  const participantIds = conversation.participants.map((participant) => participant.participantId);
  const user = conversation.participants.find((participant) => participant.kind === 'user');
  const agent = conversation.participants.find((participant) => participant.kind === 'agent');

  return (
    new Set(participantIds).size === participantIds.length &&
    user?.principalId === conversation.principalId &&
    agent?.agentRef === conversation.agentRef
  );
}

export function validateMessageAttribution(message: Message, conversation: Conversation): boolean {
  const participant = conversation.participants.find(
    (candidate) => candidate.participantId === message.participantId,
  );
  if (!participant) return false;

  return (
    (message.role === 'user' && participant.kind === 'user') ||
    (message.role === 'assistant' && participant.kind === 'agent') ||
    (message.role === 'system' && participant.kind === 'system')
  );
}
