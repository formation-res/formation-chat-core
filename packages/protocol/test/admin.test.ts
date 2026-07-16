import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  AdminConversationListSchema,
  AdminEventListSchema,
  AdminFailureListSchema,
  AdminHandoffListSchema,
  AdminRunListSchema,
  AdminTokenClaimsSchema,
} from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
formatsPlugin.default(ajv);

describe('admin API contracts', () => {
  it('binds admin tokens to one tenant, explicit sites, and read visibility scopes', () => {
    const validate = ajv.compile(AdminTokenClaimsSchema);
    const claims = {
      adminId: 'operator_1',
      tenantId: 'tenant_1',
      siteIds: ['site_1'],
      scopes: ['admin:read'],
      issuedAt: '2026-07-16T13:00:00.000Z',
      expiresAt: '2026-07-16T14:00:00.000Z',
    };

    expect(validate(claims)).toBe(true);
    expect(validate({ ...claims, siteIds: [] })).toBe(false);
    expect(validate({ ...claims, scopes: ['events:read'] })).toBe(false);
    expect(validate({ ...claims, tenantId: ['tenant_1', 'tenant_2'] })).toBe(false);
  });

  it('defines cursor-paginated conversation, event, run, failure, and handoff lists', () => {
    const pagination = { hasMore: false };
    const timestamp = '2026-07-16T13:00:00.000Z';
    const conversation = {
      conversationId: 'conversation_1',
      tenantId: 'tenant_1',
      siteId: 'site_1',
      principalId: 'principal_1',
      agentRef: 'support',
      status: 'active',
      participants: [
        { participantId: 'user_1', kind: 'user', principalId: 'principal_1' },
        { participantId: 'agent_1', kind: 'agent', agentRef: 'support' },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const run = {
      runId: 'run_1',
      tenantId: 'tenant_1',
      siteId: 'site_1',
      conversationId: 'conversation_1',
      userMessageId: 'message_1',
      assistantMessageId: 'message_2',
      agentRef: 'support',
      status: 'failed',
      attempt: 2,
      errorCode: 'HANDOFF_DELIVERY_FAILED',
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
    };
    const event = {
      eventId: 'event_1',
      sequence: 1,
      type: 'run.failed',
      occurredAt: timestamp,
      visibility: 'internal',
      conversationId: 'conversation_1',
      runId: 'run_1',
      data: { code: 'HANDOFF_DELIVERY_FAILED' },
    };
    const handoff = {
      handoffId: 'handoff_1',
      tenantId: 'tenant_1',
      siteId: 'site_1',
      conversationId: 'conversation_1',
      runId: 'run_1',
      status: 'failed',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(ajv.compile(AdminConversationListSchema)({ data: [conversation], pagination })).toBe(
      true,
    );
    expect(ajv.compile(AdminEventListSchema)({ data: [event], pagination })).toBe(true);
    expect(ajv.compile(AdminRunListSchema)({ data: [run], pagination })).toBe(true);
    expect(ajv.compile(AdminFailureListSchema)({ data: [run], pagination })).toBe(true);
    expect(ajv.compile(AdminHandoffListSchema)({ data: [handoff], pagination })).toBe(true);
    expect(
      ajv.compile(AdminFailureListSchema)({ data: [{ ...run, status: 'running' }], pagination }),
    ).toBe(false);
  });
});
