import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const responseModes = [
  'email_support',
  'email_newsletter',
  'support_chat',
  'info_chat',
  'internal_chat',
] as const;

export const HaystackConnectorConfigSchema = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1, maxLength: 2_048, pattern: '^https?://' }),
    tenantKey: Type.String({ minLength: 1, maxLength: 200 }),
    agentSlug: Type.String({ minLength: 1, maxLength: 200 }),
    responseMode: Type.Optional(Type.Union(responseModes.map((value) => Type.Literal(value)))),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000 })),
  },
  { additionalProperties: false },
);
export type HaystackConnectorConfig = Static<typeof HaystackConnectorConfigSchema>;

export const HaystackConnectorMapSchema = Type.Record(
  Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$' }),
  HaystackConnectorConfigSchema,
  { minProperties: 1, maxProperties: 100 },
);
export type HaystackConnectorMap = Static<typeof HaystackConnectorMapSchema>;

export const HaystackAgentRequestSchema = Type.Object(
  {
    channel: Type.Literal('web'),
    tenant_key: Type.String({ minLength: 1, maxLength: 200 }),
    agent_slug: Type.String({ minLength: 1, maxLength: 200 }),
    user_id: Type.String({ minLength: 1, maxLength: 2_000 }),
    thread_id: Type.String({ minLength: 1, maxLength: 2_000 }),
    text: Type.String({ minLength: 1, maxLength: 100_000 }),
    response_mode: Type.Optional(Type.Union(responseModes.map((value) => Type.Literal(value)))),
    metadata: Type.Object(
      {
        chat_core: Type.Object(
          {
            compatibility_mode: Type.Literal('duplicate_history'),
            run_id: Type.String(),
            message_id: Type.String(),
            assistant_message_id: Type.String(),
            conversation_id: Type.String(),
            agent_ref: Type.String(),
            origin: Type.Optional(Type.String({ maxLength: 2_000 })),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type HaystackAgentRequest = Static<typeof HaystackAgentRequestSchema>;

const sourceSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ maxLength: 2_000 })),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    content: Type.Optional(Type.String({ maxLength: 100_000 })),
    source_path: Type.Optional(Type.String({ maxLength: 2_048 })),
  },
  { additionalProperties: true },
);

const metadataSchema = Type.Object(
  {
    used_tools: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 100 }),
    ),
    rag_sources: Type.Optional(Type.Array(sourceSchema, { maxItems: 100 })),
    handoff: Type.Optional(
      Type.Object(
        {
          requested: Type.Boolean(),
          reason: Type.Optional(Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()])),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

export const HaystackAgentResponseSchema = Type.Object(
  {
    request_id: Type.String({ minLength: 1, maxLength: 2_000 }),
    tenant_key: Type.String({ minLength: 1, maxLength: 200 }),
    agent_slug: Type.String({ minLength: 1, maxLength: 200 }),
    channel: Type.String({ minLength: 1, maxLength: 64 }),
    thread_id: Type.String({ minLength: 1, maxLength: 2_000 }),
    text: Type.String({ minLength: 1, maxLength: 100_000 }),
    subject: Type.Optional(Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()])),
    status: Type.Optional(
      Type.Union([
        Type.Literal('completed'),
        Type.Literal('failed'),
        Type.Literal('rejected'),
        Type.Literal('ignored'),
      ]),
    ),
    metadata: Type.Optional(metadataSchema),
  },
  { additionalProperties: true },
);
export type HaystackAgentResponse = Static<typeof HaystackAgentResponseSchema>;

export function parseHaystackConfig(value: HaystackConnectorConfig): HaystackConnectorConfig {
  if (!Value.Check(HaystackConnectorConfigSchema, value)) throw invalidConfig();
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw invalidConfig();
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw invalidConfig();
  }
  return { ...value, baseUrl: url.origin };
}

export function parseHaystackConnectorMap(value: unknown): HaystackConnectorMap {
  if (!Value.Check(HaystackConnectorMapSchema, value)) throw invalidConfig();
  return Object.fromEntries(
    Object.entries(value).map(([agentRef, config]) => [agentRef, parseHaystackConfig(config)]),
  );
}

export function isHaystackAgentResponse(value: unknown): value is HaystackAgentResponse {
  return Value.Check(HaystackAgentResponseSchema, value);
}

const invalidConfig = () => new TypeError('Invalid Haystack connector configuration.');
