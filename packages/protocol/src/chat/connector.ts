import { type Static, Type } from '@sinclair/typebox';

import { OpaqueIdSchema } from '../common/index.js';
import { PrincipalSchema } from '../identity/index.js';
import { type Message, MessageSchema } from './resources.js';

const NormalizedMessageSchema = Type.Unsafe<Message>({
  ...MessageSchema,
  additionalProperties: false,
});

const CurrentUserMessageSchema = Type.Intersect([
  NormalizedMessageSchema,
  Type.Object(
    { role: Type.Literal('user'), status: Type.Literal('completed') },
    { additionalProperties: true },
  ),
]);

export const ConnectorRunRequestSchema = Type.Object(
  {
    runId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    agentRef: OpaqueIdSchema,
    currentMessage: CurrentUserMessageSchema,
    userParticipantId: OpaqueIdSchema,
    history: Type.Array(NormalizedMessageSchema, { minItems: 1, maxItems: 1_000 }),
    principalContext: PrincipalSchema,
    trustedMetadata: Type.Record(
      Type.String({ pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,127}$' }),
      Type.String({ maxLength: 2_000 }),
    ),
  },
  { additionalProperties: false },
);
export type ConnectorRunRequest = Static<typeof ConnectorRunRequestSchema>;

export const ConnectorExecutionRequestSchema = Type.Object(
  {
    assistantMessageId: OpaqueIdSchema,
    request: ConnectorRunRequestSchema,
  },
  { additionalProperties: false },
);
export type ConnectorExecutionRequest = Static<typeof ConnectorExecutionRequestSchema>;
