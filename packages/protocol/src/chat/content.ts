import { type Static, Type } from '@sinclair/typebox';

import { OpaqueIdSchema } from '../common/index.js';

export const TextPartSchema = Type.Object(
  { type: Type.Literal('text'), text: Type.String({ minLength: 1, maxLength: 100_000 }) },
  { additionalProperties: false },
);

export const CitationPartSchema = Type.Object(
  {
    type: Type.Literal('citation'),
    citationId: OpaqueIdSchema,
    sourceId: OpaqueIdSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    url: Type.Optional(Type.String({ format: 'uri', pattern: '^https://', maxLength: 2_048 })),
    excerpt: Type.Optional(Type.String({ maxLength: 2_000 })),
  },
  { additionalProperties: false },
);

export const FileReferencePartSchema = Type.Object(
  {
    type: Type.Literal('file_reference'),
    fileId: OpaqueIdSchema,
    name: Type.String({ minLength: 1, maxLength: 500 }),
    mediaType: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    url: Type.Optional(Type.String({ format: 'uri', pattern: '^https://', maxLength: 2_048 })),
  },
  { additionalProperties: false },
);

export const ToolStatusPartSchema = Type.Object(
  {
    type: Type.Literal('tool_status'),
    toolCallId: OpaqueIdSchema,
    label: Type.String({ minLength: 1, maxLength: 200 }),
    status: Type.Union([
      Type.Literal('started'),
      Type.Literal('completed'),
      Type.Literal('failed'),
    ]),
  },
  { additionalProperties: false },
);

export const StructuredInputPartSchema = Type.Object(
  {
    type: Type.Literal('structured_input'),
    requestId: OpaqueIdSchema,
    inputKind: Type.Literal('email'),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    required: Type.Boolean(),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('submitted'),
      Type.Literal('declined'),
    ]),
  },
  { additionalProperties: false },
);

export const ContentPartSchema = Type.Union([
  TextPartSchema,
  CitationPartSchema,
  FileReferencePartSchema,
  ToolStatusPartSchema,
  StructuredInputPartSchema,
]);
export type ContentPart = Static<typeof ContentPartSchema>;
