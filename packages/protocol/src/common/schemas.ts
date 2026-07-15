import { type Static, Type } from '@sinclair/typebox';

const opaqueId = () =>
  Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
  });

const timestamp = () => Type.String({ format: 'date-time', pattern: 'Z$' });

const cursor = () => Type.String({ minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' });

export const OpaqueIdSchema = opaqueId();
export type OpaqueId = Static<typeof OpaqueIdSchema>;

export const TimestampSchema = timestamp();
export type Timestamp = Static<typeof TimestampSchema>;

export const CursorSchema = cursor();
export type Cursor = Static<typeof CursorSchema>;

export const CursorPageRequestSchema = Type.Object(
  {
    cursor: Type.Optional(cursor()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: true },
);
export type CursorPageRequest = Static<typeof CursorPageRequestSchema>;

export const CursorPageSchema = Type.Union([
  Type.Object(
    { hasMore: Type.Literal(true), nextCursor: cursor() },
    { additionalProperties: true },
  ),
  Type.Object(
    { hasMore: Type.Literal(false), nextCursor: Type.Optional(cursor()) },
    { additionalProperties: true },
  ),
]);
export type CursorPage = Static<typeof CursorPageSchema>;

const errorCode = () => Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Z][A-Z0-9_]*$' });

export const ErrorEnvelopeSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: errorCode(),
        message: Type.String({ minLength: 1, maxLength: 512 }),
        correlationId: opaqueId(),
        fieldErrors: Type.Optional(
          Type.Array(
            Type.Object(
              {
                field: Type.String({ minLength: 1, maxLength: 256 }),
                code: errorCode(),
                message: Type.String({ minLength: 1, maxLength: 512 }),
              },
              { additionalProperties: true },
            ),
            { maxItems: 100 },
          ),
        ),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;

export const IdempotencyMetadataSchema = Type.Object(
  {
    idempotencyKey: Type.String({
      minLength: 1,
      maxLength: 255,
      pattern: '^[\\x21-\\x7E]+$',
    }),
    requestHash: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
  },
  { additionalProperties: true },
);
export type IdempotencyMetadata = Static<typeof IdempotencyMetadataSchema>;

export const VisibilitySchema = Type.Union([
  Type.Literal('public'),
  Type.Literal('operator'),
  Type.Literal('internal'),
]);
export type Visibility = Static<typeof VisibilitySchema>;

export const EventEnvelopeSchema = Type.Object(
  {
    eventId: opaqueId(),
    sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    type: Type.String({
      minLength: 3,
      maxLength: 128,
      pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+$',
    }),
    occurredAt: timestamp(),
    visibility: VisibilitySchema,
    conversationId: opaqueId(),
    runId: Type.Optional(opaqueId()),
    messageId: Type.Optional(opaqueId()),
  },
  { additionalProperties: true },
);
export type EventEnvelope = Static<typeof EventEnvelopeSchema>;

export const commonSchemaArtifacts = {
  'cursor-page-request': CursorPageRequestSchema,
  'cursor-page': CursorPageSchema,
  'error-envelope': ErrorEnvelopeSchema,
  'event-envelope': EventEnvelopeSchema,
  'idempotency-metadata': IdempotencyMetadataSchema,
  'opaque-id': OpaqueIdSchema,
  timestamp: TimestampSchema,
  visibility: VisibilitySchema,
} as const;
