import { type Static, Type } from '@sinclair/typebox';

import { CursorPageSchema, OpaqueIdSchema } from '../common/index.js';
import { TextPartSchema } from './content.js';
import { ConversationSchema, MessageSchema } from './resources.js';

export const CreateConversationRequestSchema = Type.Object({}, { additionalProperties: false });
export type CreateConversationRequest = Static<typeof CreateConversationRequestSchema>;

export const SubmitMessageRequestSchema = Type.Object(
  {
    parts: Type.Array(TextPartSchema, {
      minItems: 1,
      maxItems: 100,
    }),
  },
  { additionalProperties: false },
);
export type SubmitMessageRequest = Static<typeof SubmitMessageRequestSchema>;

export const SubmitStructuredInputRequestSchema = Type.Union([
  Type.Object(
    { value: Type.String({ format: 'email', maxLength: 320 }), consent: Type.Literal(true) },
    { additionalProperties: false },
  ),
  Type.Object({ declined: Type.Literal(true) }, { additionalProperties: false }),
]);
export type SubmitStructuredInputRequest = Static<typeof SubmitStructuredInputRequestSchema>;

export const CancelRunResponseSchema = Type.Object(
  {
    conversationId: OpaqueIdSchema,
    runId: OpaqueIdSchema,
    cancellationStatus: Type.Union([
      Type.Literal('cancel_requested'),
      Type.Literal('cancelled'),
      Type.Literal('already_finished'),
    ]),
  },
  { additionalProperties: false },
);
export type CancelRunResponse = Static<typeof CancelRunResponseSchema>;

export const ConversationListSchema = Type.Object(
  { data: Type.Array(ConversationSchema), pagination: CursorPageSchema },
  { additionalProperties: true },
);
export type ConversationList = Static<typeof ConversationListSchema>;

export const MessageListSchema = Type.Object(
  { data: Type.Array(MessageSchema), pagination: CursorPageSchema },
  { additionalProperties: true },
);
export type MessageList = Static<typeof MessageListSchema>;
