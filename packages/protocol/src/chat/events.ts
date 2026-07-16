import { type Static, type TSchema, Type } from '@sinclair/typebox';

import { EventEnvelopeSchema, OpaqueIdSchema, VisibilitySchema } from '../common/index.js';
import { CitationPartSchema, ContentPartSchema, StructuredInputPurposeSchema } from './content.js';

interface EventDefinition {
  readonly type: string;
  readonly data: TSchema;
  readonly requiresMessageId?: boolean;
}

const emptyData = () => Type.Object({}, { additionalProperties: false });
const failureData = () =>
  Type.Object(
    { code: Type.String({ pattern: '^[A-Z][A-Z0-9_]*$', maxLength: 64 }) },
    { additionalProperties: false },
  );

const definitions = [
  {
    type: 'run.started',
    data: Type.Object({ agentRef: OpaqueIdSchema }, { additionalProperties: false }),
  },
  { type: 'run.completed', data: emptyData() },
  { type: 'run.failed', data: failureData() },
  {
    type: 'message.started',
    data: Type.Object({ role: Type.Literal('assistant') }, { additionalProperties: false }),
    requiresMessageId: true,
  },
  {
    type: 'message.delta',
    data: Type.Object(
      { delta: Type.String({ minLength: 1, maxLength: 20_000 }) },
      { additionalProperties: false },
    ),
    requiresMessageId: true,
  },
  {
    type: 'message.completed',
    data: Type.Object(
      { parts: Type.Array(ContentPartSchema, { minItems: 1 }) },
      { additionalProperties: false },
    ),
    requiresMessageId: true,
  },
  {
    type: 'tool.started',
    data: Type.Object(
      {
        toolCallId: OpaqueIdSchema,
        label: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    requiresMessageId: true,
  },
  {
    type: 'tool.completed',
    data: Type.Object({ toolCallId: OpaqueIdSchema }, { additionalProperties: false }),
    requiresMessageId: true,
  },
  {
    type: 'tool.failed',
    data: Type.Object({ toolCallId: OpaqueIdSchema }, { additionalProperties: false }),
    requiresMessageId: true,
  },
  {
    type: 'citation.added',
    data: Type.Omit(CitationPartSchema, ['type'], { additionalProperties: false }),
    requiresMessageId: true,
  },
  {
    type: 'contact.requested',
    data: Type.Object(
      {
        requestId: OpaqueIdSchema,
        inputKind: Type.Literal('email'),
        purpose: StructuredInputPurposeSchema,
        prompt: Type.String({ minLength: 1, maxLength: 500 }),
        required: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  {
    type: 'handoff.requested',
    data: Type.Object({ handoffId: OpaqueIdSchema }, { additionalProperties: false }),
  },
  {
    type: 'handoff.completed',
    data: Type.Object(
      { handoffId: OpaqueIdSchema, status: Type.Literal('completed') },
      { additionalProperties: false },
    ),
  },
] as const satisfies readonly EventDefinition[];

const connectorEvent = ({ type, data, requiresMessageId }: EventDefinition) =>
  Type.Object(
    {
      type: Type.Literal(type),
      visibility: VisibilitySchema,
      conversationId: OpaqueIdSchema,
      runId: OpaqueIdSchema,
      ...(requiresMessageId ? { messageId: OpaqueIdSchema } : {}),
      data,
    },
    { additionalProperties: false },
  );

const conversationEvent = ({ type, data, requiresMessageId }: EventDefinition) =>
  Type.Object(
    {
      ...EventEnvelopeSchema.properties,
      type: Type.Literal(type),
      runId: OpaqueIdSchema,
      ...(requiresMessageId ? { messageId: OpaqueIdSchema } : {}),
      data,
    },
    { additionalProperties: false },
  );

const publicConversationEvent = ({ type, data, requiresMessageId }: EventDefinition) =>
  Type.Object(
    {
      ...EventEnvelopeSchema.properties,
      type: Type.Literal(type),
      visibility: Type.Literal('public'),
      runId: OpaqueIdSchema,
      ...(requiresMessageId ? { messageId: OpaqueIdSchema } : {}),
      data,
    },
    { additionalProperties: false },
  );

const eventUnion = (schemas: TSchema[]) => Type.Union(schemas as [TSchema, TSchema, ...TSchema[]]);

export const ConnectorEventSchema = eventUnion(definitions.map(connectorEvent));

const SyncRequiredEventSchema = Type.Object(
  {
    ...EventEnvelopeSchema.properties,
    type: Type.Literal('sync.required'),
    visibility: Type.Literal('public'),
    data: Type.Object(
      { reason: Type.Literal('retention_window_exceeded') },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ConversationEventSchema = eventUnion([
  ...definitions.map(conversationEvent),
  SyncRequiredEventSchema,
]);

export const PublicConversationEventSchema = eventUnion([
  ...definitions.map(publicConversationEvent),
  SyncRequiredEventSchema,
]);

type Definition = (typeof definitions)[number];
type DefinitionData<T extends Definition> = Static<T['data']>;
type MessageCorrelation<T extends Definition> = T extends { requiresMessageId: true }
  ? { messageId: string }
  : { messageId?: string };
type ConnectorEventFor<T extends Definition> = T extends Definition
  ? {
      type: T['type'];
      visibility: Static<typeof VisibilitySchema>;
      conversationId: string;
      runId: string;
      data: DefinitionData<T>;
    } & MessageCorrelation<T>
  : never;
type ConversationEventFor<T extends Definition> = T extends Definition
  ? ConnectorEventFor<T> & { eventId: string; sequence: number; occurredAt: string }
  : never;

export type ConnectorEvent = ConnectorEventFor<Definition>;
export type ConversationEvent =
  | ConversationEventFor<Definition>
  | {
      eventId: string;
      sequence: number;
      type: 'sync.required';
      occurredAt: string;
      visibility: 'public';
      conversationId: string;
      runId?: string;
      messageId?: string;
      data: { reason: 'retention_window_exceeded' };
    };
type PublicConversationEventFor<T extends Definition> = T extends Definition
  ? Omit<ConversationEventFor<T>, 'visibility'> & { visibility: 'public' }
  : never;
export type PublicConversationEvent =
  PublicConversationEventFor<Definition> | Extract<ConversationEvent, { type: 'sync.required' }>;
