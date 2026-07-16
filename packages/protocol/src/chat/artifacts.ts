import {
  CancelRunResponseSchema,
  ConversationListSchema,
  CreateConversationRequestSchema,
  MessageListSchema,
  SubmitMessageRequestSchema,
  SubmitStructuredInputRequestSchema,
} from './api.js';
import {
  ConnectorExecutionRequestSchema,
  ConnectorRunRequestSchema,
  StructuredInputResolutionSchema,
} from './connector.js';
import {
  CitationPartSchema,
  ContentPartSchema,
  FileReferencePartSchema,
  StructuredInputPartSchema,
  TextPartSchema,
  ToolStatusPartSchema,
} from './content.js';
import {
  ConnectorEventSchema,
  ConversationEventSchema,
  PublicConversationEventSchema,
} from './events.js';
import {
  AgentRunSchema,
  ConversationSchema,
  HandoffSchema,
  MessageSchema,
  ParticipantSchema,
  StructuredInputRequestSchema,
} from './resources.js';

export const chatSchemaArtifacts = {
  'cancel-run-response': CancelRunResponseSchema,
  'agent-run': AgentRunSchema,
  'citation-part': CitationPartSchema,
  'connector-event': ConnectorEventSchema,
  'connector-execution-request': ConnectorExecutionRequestSchema,
  'connector-run-request': ConnectorRunRequestSchema,
  'content-part': ContentPartSchema,
  conversation: ConversationSchema,
  'conversation-event': ConversationEventSchema,
  'public-conversation-event': PublicConversationEventSchema,
  'conversation-list': ConversationListSchema,
  'create-conversation-request': CreateConversationRequestSchema,
  'file-reference-part': FileReferencePartSchema,
  handoff: HandoffSchema,
  message: MessageSchema,
  'message-list': MessageListSchema,
  participant: ParticipantSchema,
  'structured-input-part': StructuredInputPartSchema,
  'structured-input-request': StructuredInputRequestSchema,
  'structured-input-resolution': StructuredInputResolutionSchema,
  'submit-message-request': SubmitMessageRequestSchema,
  'submit-structured-input-request': SubmitStructuredInputRequestSchema,
  'text-part': TextPartSchema,
  'tool-status-part': ToolStatusPartSchema,
} as const;
