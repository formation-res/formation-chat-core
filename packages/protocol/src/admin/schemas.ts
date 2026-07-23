import { type Static, Type, type TSchema } from '@sinclair/typebox';

import {
  CursorPageSchema,
  CursorSchema,
  OpaqueIdSchema,
  TimestampSchema,
} from '../common/index.js';
import { ConversationEventSchema, ConversationSchema, MessageSchema } from '../chat/index.js';

export const AdminAccessScopeSchema = Type.Union([
  Type.Literal('admin:read'),
  Type.Literal('admin:internal'),
]);
export type AdminAccessScope = Static<typeof AdminAccessScopeSchema>;

export const AdminTokenClaimsSchema = Type.Object(
  {
    adminId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    siteIds: Type.Array(OpaqueIdSchema, { minItems: 1, maxItems: 100, uniqueItems: true }),
    scopes: Type.Array(AdminAccessScopeSchema, { minItems: 1, uniqueItems: true }),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type AdminTokenClaims = Static<typeof AdminTokenClaimsSchema>;

export const AdminAgentRunStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('waiting_for_input'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancel_requested'),
  Type.Literal('cancelled'),
]);
export type AdminAgentRunStatus = Static<typeof AdminAgentRunStatusSchema>;

export const AdminAgentRunSchema = Type.Object(
  {
    runId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    userMessageId: OpaqueIdSchema,
    assistantMessageId: OpaqueIdSchema,
    agentRef: OpaqueIdSchema,
    status: AdminAgentRunStatusSchema,
    attempt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    errorCode: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Z][A-Z0-9_]*$' }),
    ),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: Type.Optional(TimestampSchema),
  },
  { additionalProperties: false },
);
export type AdminAgentRun = Static<typeof AdminAgentRunSchema>;

export const AdminFailureSchema = Type.Composite([
  Type.Omit(AdminAgentRunSchema, ['status', 'errorCode']),
  Type.Object({
    status: Type.Literal('failed'),
    errorCode: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Z][A-Z0-9_]*$' }),
  }),
]);
export type AdminFailure = Static<typeof AdminFailureSchema>;

export const AdminHandoffStatusSchema = Type.Union([
  Type.Literal('requested'),
  Type.Literal('awaiting_contact'),
  Type.Literal('delivering'),
  Type.Literal('completed'),
  Type.Literal('failed'),
]);
export type AdminHandoffStatus = Static<typeof AdminHandoffStatusSchema>;

export const AdminHandoffSchema = Type.Object(
  {
    handoffId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    siteId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
    runId: OpaqueIdSchema,
    status: AdminHandoffStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type AdminHandoff = Static<typeof AdminHandoffSchema>;

export const AdminWidgetAgentAliasSchema = Type.Object(
  {
    alias: OpaqueIdSchema,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    agentRef: OpaqueIdSchema,
  },
  { additionalProperties: false },
);
export type AdminWidgetAgentAlias = Static<typeof AdminWidgetAgentAliasSchema>;

export const AdminSiteWidgetSchema = Type.Object(
  {
    widgetId: OpaqueIdSchema,
    widgetKey: OpaqueIdSchema,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    version: OpaqueIdSchema,
    theme: OpaqueIdSchema,
    launcher: OpaqueIdSchema,
    placement: OpaqueIdSchema,
    defaultAgentAlias: OpaqueIdSchema,
    agentAliases: Type.Array(AdminWidgetAgentAliasSchema, { minItems: 1, maxItems: 20 }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type AdminSiteWidget = Static<typeof AdminSiteWidgetSchema>;

export const AdminSiteOverviewSchema = Type.Object(
  {
    siteId: OpaqueIdSchema,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    siteKey: OpaqueIdSchema,
    allowedOrigins: Type.Array(Type.String({ format: 'uri' }), { minItems: 1, maxItems: 20 }),
    agentRef: OpaqueIdSchema,
    widgets: Type.Array(AdminSiteWidgetSchema, { maxItems: 20 }),
    stats: Type.Object(
      {
        conversations: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        activeConversations: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        runs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        failures: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        handoffs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      },
      { additionalProperties: false },
    ),
    recentActivityAt: Type.Optional(TimestampSchema),
  },
  { additionalProperties: false },
);
export type AdminSiteOverview = Static<typeof AdminSiteOverviewSchema>;

export const AdminOverviewSchema = Type.Object(
  {
    tenant: Type.Object(
      {
        tenantId: OpaqueIdSchema,
        displayName: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    sites: Type.Array(AdminSiteOverviewSchema, { maxItems: 100 }),
    totals: Type.Object(
      {
        conversations: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        activeConversations: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        runs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        failures: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        handoffs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type AdminOverview = Static<typeof AdminOverviewSchema>;

const listSchema = <T extends TSchema>(item: T) =>
  Type.Object(
    { data: Type.Array(item, { maxItems: 100 }), pagination: CursorPageSchema },
    { additionalProperties: false },
  );

export const AdminConversationListSchema = listSchema(ConversationSchema);
export type AdminConversationList = Static<typeof AdminConversationListSchema>;
export const AdminMessageListSchema = listSchema(MessageSchema);
export type AdminMessageList = Static<typeof AdminMessageListSchema>;
export const AdminEventListSchema = listSchema(ConversationEventSchema);
export type AdminEventList = Static<typeof AdminEventListSchema>;
export const AdminRunListSchema = listSchema(AdminAgentRunSchema);
export type AdminRunList = Static<typeof AdminRunListSchema>;
export const AdminFailureListSchema = listSchema(AdminFailureSchema);
export type AdminFailureList = Static<typeof AdminFailureListSchema>;
export const AdminHandoffListSchema = listSchema(AdminHandoffSchema);
export type AdminHandoffList = Static<typeof AdminHandoffListSchema>;

const commonFilters = {
  siteId: Type.Optional(OpaqueIdSchema),
  agentRef: Type.Optional(OpaqueIdSchema),
  createdAfter: Type.Optional(TimestampSchema),
  createdBefore: Type.Optional(TimestampSchema),
  cursor: Type.Optional(CursorSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
};

export const AdminConversationFilterSchema = Type.Object(
  {
    ...commonFilters,
    status: Type.Optional(
      Type.Union([Type.Literal('active'), Type.Literal('completed'), Type.Literal('cancelled')]),
    ),
  },
  { additionalProperties: false },
);
export type AdminConversationFilter = Static<typeof AdminConversationFilterSchema>;

export const AdminRunFilterSchema = Type.Object(
  { ...commonFilters, status: Type.Optional(AdminAgentRunStatusSchema) },
  { additionalProperties: false },
);
export type AdminRunFilter = Static<typeof AdminRunFilterSchema>;

export const AdminHandoffFilterSchema = Type.Object(
  { ...commonFilters, status: Type.Optional(AdminHandoffStatusSchema) },
  { additionalProperties: false },
);
export type AdminHandoffFilter = Static<typeof AdminHandoffFilterSchema>;
