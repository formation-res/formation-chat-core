import { type Static, Type } from '@sinclair/typebox';

import { OpaqueIdSchema, TimestampSchema } from '../common/index.js';
import { ContentPartSchema } from './content.js';

const UserParticipantSchema = Type.Object(
  {
    participantId: OpaqueIdSchema,
    kind: Type.Literal('user'),
    principalId: OpaqueIdSchema,
    agentRef: Type.Optional(Type.Never()),
  },
  { additionalProperties: true },
);

const AgentParticipantSchema = Type.Object(
  {
    participantId: OpaqueIdSchema,
    kind: Type.Literal('agent'),
    principalId: Type.Optional(Type.Never()),
    agentRef: OpaqueIdSchema,
  },
  { additionalProperties: true },
);

const FutureParticipantSchema = Type.Object(
  {
    participantId: OpaqueIdSchema,
    kind: Type.String({
      pattern: '^[a-z][a-z0-9_]*$',
      maxLength: 64,
      not: { enum: ['user', 'agent'] },
    }),
    principalId: Type.Optional(OpaqueIdSchema),
    agentRef: Type.Optional(OpaqueIdSchema),
  },
  { additionalProperties: true },
);

export const ParticipantSchema = Type.Union([
  UserParticipantSchema,
  AgentParticipantSchema,
  FutureParticipantSchema,
]);
export type Participant = Static<typeof ParticipantSchema>;

const participantsSchema = Type.Unsafe<Participant[]>({
  type: 'array',
  items: ParticipantSchema,
  minItems: 2,
  allOf: [
    {
      contains: { type: 'object', properties: { kind: { const: 'user' } }, required: ['kind'] },
      minContains: 1,
      maxContains: 1,
    },
    {
      contains: { type: 'object', properties: { kind: { const: 'agent' } }, required: ['kind'] },
      minContains: 1,
      maxContains: 1,
    },
  ],
});

export const ConversationSchema = Type.Object(
  {
    conversationId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    principalId: OpaqueIdSchema,
    agentRef: OpaqueIdSchema,
    status: Type.Union([
      Type.Literal('active'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
    ]),
    participants: participantsSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type Conversation = Static<typeof ConversationSchema>;

export const MessageSchema = Type.Object(
  {
    messageId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    participantId: OpaqueIdSchema,
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('streaming'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    parts: Type.Array(ContentPartSchema),
    createdAt: TimestampSchema,
    completedAt: Type.Optional(TimestampSchema),
  },
  {
    additionalProperties: true,
    allOf: [
      {
        if: { properties: { status: { const: 'completed' } }, required: ['status'] },
        then: {
          required: ['completedAt'],
          properties: {
            completedAt: TimestampSchema,
            parts: { type: 'array', minItems: 1 },
          },
        },
      },
      {
        if: {
          properties: { status: { enum: ['pending', 'streaming'] } },
          required: ['status'],
        },
        then: { not: { required: ['completedAt'] } },
      },
    ],
  },
);
export type Message = Static<typeof MessageSchema>;

export const AgentRunSchema = Type.Object(
  {
    runId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    userMessageId: OpaqueIdSchema,
    assistantMessageId: Type.Optional(OpaqueIdSchema),
    agentRef: OpaqueIdSchema,
    status: Type.Union([
      Type.Literal('queued'),
      Type.Literal('running'),
      Type.Literal('waiting_for_input'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type AgentRun = Static<typeof AgentRunSchema>;

export const StructuredInputRequestSchema = Type.Object(
  {
    requestId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    runId: OpaqueIdSchema,
    inputKind: Type.Literal('email'),
    prompt: Type.String({ minLength: 1, maxLength: 500 }),
    required: Type.Boolean(),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('submitted'),
      Type.Literal('declined'),
      Type.Literal('expired'),
    ]),
    createdAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type StructuredInputRequest = Static<typeof StructuredInputRequestSchema>;

export const HandoffSchema = Type.Object(
  {
    handoffId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    runId: OpaqueIdSchema,
    status: Type.Union([
      Type.Literal('requested'),
      Type.Literal('awaiting_contact'),
      Type.Literal('delivering'),
      Type.Literal('completed'),
      Type.Literal('failed'),
    ]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: true },
);
export type Handoff = Static<typeof HandoffSchema>;
