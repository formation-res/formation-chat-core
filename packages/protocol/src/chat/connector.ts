import { type Static, Type } from '@sinclair/typebox';

import { OpaqueIdSchema, TimestampSchema } from '../common/index.js';
import { PrincipalSchema } from '../identity/index.js';
import { StructuredInputPurposeSchema } from './content.js';
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

const inputResolutionBase = {
  requestId: OpaqueIdSchema,
  inputKind: Type.Literal('email'),
  purpose: StructuredInputPurposeSchema,
};

export const StructuredInputResolutionSchema = Type.Union([
  Type.Object(
    {
      ...inputResolutionBase,
      status: Type.Literal('submitted'),
      value: Type.String({ format: 'email', maxLength: 320 }),
      consent: Type.Object(
        { status: Type.Literal('granted'), recordedAt: TimestampSchema },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...inputResolutionBase,
      status: Type.Literal('declined'),
      consent: Type.Object(
        { status: Type.Literal('declined'), recordedAt: TimestampSchema },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
export type StructuredInputResolution = Static<typeof StructuredInputResolutionSchema>;

export const ConnectorRunRequestSchema = Type.Object(
  {
    runId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    agentRef: OpaqueIdSchema,
    currentMessage: CurrentUserMessageSchema,
    userParticipantId: OpaqueIdSchema,
    history: Type.Array(NormalizedMessageSchema, { minItems: 1, maxItems: 1_000 }),
    principalContext: PrincipalSchema,
    resolvedInputs: Type.Array(StructuredInputResolutionSchema, { maxItems: 10 }),
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
