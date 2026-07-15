import { readFile } from 'node:fs/promises';

import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  ConnectorEventSchema,
  ConnectorRunRequestSchema,
  ConversationSchema,
  ConversationEventSchema,
  CreateConversationRequestSchema,
  MessageSchema,
  PublicConversationEventSchema,
  SubmitMessageRequestSchema,
  validateConnectorEventContext,
  validateConnectorRunRequestContext,
  validateConversationParticipantContext,
  validateMessageAttribution,
} from '../src/index.js';
import type { ConnectorEvent, ConnectorRunRequest, Conversation, Message } from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
formatsPlugin.default(ajv);

const envelope = {
  eventId: 'event_01JY5N7P8Q',
  sequence: 1,
  occurredAt: '2026-07-15T12:30:45.123Z',
  visibility: 'public',
  conversationId: 'conversation_01JY5N7P8Q',
  runId: 'run_01JY5N7P8Q',
};

const readConnectorDelta = (event: ConnectorEvent): string | undefined => {
  if (event.type === 'message.delta') return event.data.delta;
  return undefined;
};

describe('chat and connector contracts', () => {
  it('exports a discriminated TypeScript connector event union', () => {
    expect(
      readConnectorDelta({
        type: 'message.delta',
        visibility: 'public',
        conversationId: 'conversation_1',
        runId: 'run_1',
        messageId: 'message_1',
        data: { delta: 'Hello' },
      }),
    ).toBe('Hello');
  });

  it('requires exactly one v1 user and one v1 agent participant', () => {
    const validate = ajv.compile(ConversationSchema);
    const conversation = {
      conversationId: 'conversation_1',
      tenantId: 'tenant_1',
      siteId: 'site_1',
      principalId: 'principal_1',
      agentRef: 'agent_ref_1',
      status: 'active',
      participants: [
        { participantId: 'participant_user', kind: 'user', principalId: 'principal_1' },
        { participantId: 'participant_agent', kind: 'agent', agentRef: 'agent_ref_1' },
      ],
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
    } satisfies Conversation;

    expect(validate(conversation)).toBe(true);
    expect(validateConversationParticipantContext(conversation)).toBe(true);
    expect(validate({ ...conversation, participants: [conversation.participants[0]] })).toBe(false);
    expect(
      validate({
        ...conversation,
        participants: [conversation.participants[0], conversation.participants[0]],
      }),
    ).toBe(false);
    expect(
      validateConversationParticipantContext({
        ...conversation,
        participants: [
          { participantId: 'duplicate', kind: 'user', principalId: 'principal_1' },
          { participantId: 'duplicate', kind: 'agent', agentRef: 'agent_ref_1' },
        ],
      }),
    ).toBe(false);
    expect(
      validate({
        ...conversation,
        participants: [
          { participantId: 'participant_user', kind: 'user' },
          { participantId: 'participant_agent', kind: 'agent' },
        ],
      }),
    ).toBe(false);
  });

  it('prevents browser requests from selecting trusted agent routing', () => {
    const validate = ajv.compile(CreateConversationRequestSchema);

    expect(validate({})).toBe(true);
    expect(validate({ agentRef: 'privileged_agent' })).toBe(false);
  });

  it('limits user message submissions to user-safe content', () => {
    const validate = ajv.compile(SubmitMessageRequestSchema);

    expect(validate({ parts: [{ type: 'text', text: 'Hello' }] })).toBe(true);
    expect(
      validate({
        parts: [
          { type: 'tool_status', toolCallId: 'tool_1', label: 'Spoofed', status: 'completed' },
        ],
      }),
    ).toBe(false);
    expect(
      validate({ parts: [{ type: 'file_reference', fileId: 'file_1', url: 'http://127.0.0.1/' }] }),
    ).toBe(false);
  });

  it('validates discriminated public message parts', () => {
    const validate = ajv.compile(MessageSchema);
    const message = {
      messageId: 'message_01JY5N7P8Q',
      conversationId: 'conversation_01JY5N7P8Q',
      sequence: 2,
      participantId: 'agent_01JY5N7P8Q',
      role: 'assistant',
      status: 'completed',
      parts: [
        { type: 'text', text: 'Use the documented API.' },
        {
          type: 'citation',
          citationId: 'citation_01JY5N7P8Q',
          sourceId: 'source_01JY5N7P8Q',
          title: 'API guide',
          url: 'https://example.com/guide',
        },
        {
          type: 'tool_status',
          toolCallId: 'tool_01JY5N7P8Q',
          label: 'Search documentation',
          status: 'completed',
        },
      ],
      createdAt: '2026-07-15T12:30:45.123Z',
      completedAt: '2026-07-15T12:30:46.123Z',
    } satisfies Message;

    expect(validate(message)).toBe(true);
    expect(
      validateMessageAttribution(message, {
        conversationId: 'conversation_01JY5N7P8Q',
        tenantId: 'tenant_1',
        siteId: 'site_1',
        principalId: 'principal_1',
        agentRef: 'agent_ref_1',
        status: 'active',
        participants: [
          { participantId: 'user_1', kind: 'user', principalId: 'principal_1' },
          { participantId: 'agent_01JY5N7P8Q', kind: 'agent', agentRef: 'agent_ref_1' },
        ],
        createdAt: '2026-07-15T12:00:00.000Z',
        updatedAt: '2026-07-15T12:00:00.000Z',
      }),
    ).toBe(true);
    expect(validate({ ...message, parts: [], completedAt: undefined })).toBe(false);
    expect(
      validate({ ...message, parts: [{ type: 'reasoning', text: 'private chain of thought' }] }),
    ).toBe(false);
    expect(
      validate({
        ...message,
        parts: [
          {
            type: 'citation',
            citationId: 'citation_1',
            sourceId: 'source_1',
            url: 'javascript:alert(1)',
          },
        ],
      }),
    ).toBe(false);
  });

  it.each([
    ['normal stream', { type: 'message.delta', messageId: 'message_1', data: { delta: 'Hi' } }],
    [
      'tool status',
      {
        type: 'tool.started',
        messageId: 'message_1',
        data: { toolCallId: 'tool_1', label: 'Search documentation' },
      },
    ],
    [
      'citation',
      {
        type: 'citation.added',
        messageId: 'message_1',
        data: { citationId: 'citation_1', sourceId: 'source_1', title: 'Guide' },
      },
    ],
    [
      'contact request',
      {
        type: 'contact.requested',
        data: { requestId: 'request_1', inputKind: 'email', prompt: 'Where can we reach you?' },
      },
    ],
    [
      'completed handoff',
      {
        type: 'handoff.completed',
        data: { handoffId: 'handoff_1', status: 'completed' },
      },
    ],
    [
      'failure',
      {
        type: 'run.failed',
        visibility: 'operator',
        data: { code: 'CONNECTOR_TIMEOUT' },
      },
    ],
    [
      'reconnect fallback',
      {
        type: 'sync.required',
        data: { reason: 'retention_window_exceeded' },
      },
    ],
  ])('validates the %s event fixture', (_name, event) => {
    const validate = ajv.compile(ConversationEventSchema);

    expect(validate({ ...envelope, ...event })).toBe(true);
  });

  it('constrains the browser SSE payload contract to public visibility', () => {
    const validate = ajv.compile(PublicConversationEventSchema);
    const failedRun = {
      ...envelope,
      type: 'run.failed',
      data: { code: 'CONNECTOR_TIMEOUT' },
    };

    expect(validate(failedRun)).toBe(true);
    expect(validate({ ...failedRun, visibility: 'operator' })).toBe(false);
  });

  it('does not admit raw tool inputs or reasoning into connector events', () => {
    const validate = ajv.compile(ConnectorEventSchema);
    const connectorEnvelope = {
      visibility: 'public',
      conversationId: 'conversation_01JY5N7P8Q',
      runId: 'run_01JY5N7P8Q',
    };

    expect(
      validate({
        ...connectorEnvelope,
        type: 'tool.started',
        data: { toolCallId: 'tool_1', label: 'Search', rawInput: { password: 'secret' } },
      }),
    ).toBe(false);
    expect(
      validateConnectorEventContext(
        {
          type: 'message.delta',
          visibility: 'public',
          conversationId: 'conversation_other',
          runId: 'run_1',
          messageId: 'message_1',
          data: { delta: 'wrong conversation' },
        },
        {
          conversationId: 'conversation_1',
          runId: 'run_1',
          assistantMessageId: 'message_1',
        },
      ),
    ).toBe(false);
    expect(
      validateConnectorEventContext(
        {
          type: 'message.delta',
          visibility: 'public',
          conversationId: 'conversation_1',
          runId: 'run_1',
          messageId: 'message_other',
          data: { delta: 'wrong message' },
        },
        {
          conversationId: 'conversation_1',
          runId: 'run_1',
          assistantMessageId: 'message_1',
        },
      ),
    ).toBe(false);
    expect(
      validate({
        ...connectorEnvelope,
        type: 'reasoning.delta',
        data: { delta: 'private reasoning' },
      }),
    ).toBe(false);
    expect(
      validate({
        ...connectorEnvelope,
        type: 'message.delta',
        messageId: undefined,
        data: { delta: 'missing correlation' },
      }),
    ).toBe(false);
    expect(
      validate({
        ...connectorEnvelope,
        type: 'sync.required',
        data: { reason: 'retention_window_exceeded' },
      }),
    ).toBe(false);
    expect(
      validate({
        ...connectorEnvelope,
        type: 'run.failed',
        data: { code: 'FAILED', message: 'provider secret' },
        rawToolResult: { password: 'secret' },
      }),
    ).toBe(false);
  });

  it('defines a language-neutral connector run request', () => {
    const validate = ajv.compile(ConnectorRunRequestSchema);
    const userMessage = {
      messageId: 'message_1',
      conversationId: 'conversation_1',
      sequence: 1,
      participantId: 'participant_user',
      role: 'user',
      status: 'completed',
      parts: [{ type: 'text', text: 'Hello' }],
      createdAt: '2026-07-15T12:00:00.000Z',
      completedAt: '2026-07-15T12:00:00.000Z',
    } satisfies Message;

    const request = {
      runId: 'run_1',
      conversationId: 'conversation_1',
      agentRef: 'agent_1',
      currentMessage: userMessage,
      userParticipantId: 'participant_user',
      history: [userMessage],
      principalContext: { principalId: 'principal_1', kind: 'anonymous' },
      trustedMetadata: { origin: 'https://example.com' },
    } satisfies ConnectorRunRequest;

    expect(validate(request)).toBe(true);
    expect(
      validate({
        ...request,
        currentMessage: { ...userMessage, rawToolResult: { secret: 'must-not-cross-boundary' } },
      }),
    ).toBe(false);
    expect(
      validateConnectorRunRequestContext(request, {
        conversationId: 'conversation_1',
        runId: 'run_1',
        agentRef: 'agent_1',
        userParticipantId: 'participant_user',
        currentMessageId: 'message_1',
      }),
    ).toBe(true);
    expect(
      validateConnectorRunRequestContext(
        { ...request, history: [{ ...userMessage, conversationId: 'conversation_other' }] },
        {
          conversationId: 'conversation_1',
          runId: 'run_1',
          agentRef: 'agent_1',
          userParticipantId: 'participant_user',
          currentMessageId: 'message_1',
        },
      ),
    ).toBe(false);
    expect(
      validateConnectorRunRequestContext(
        {
          ...request,
          userParticipantId: 'participant_other',
          currentMessage: { ...userMessage, participantId: 'participant_other' },
        },
        {
          conversationId: 'conversation_1',
          runId: 'run_1',
          agentRef: 'agent_1',
          userParticipantId: 'participant_user',
          currentMessageId: 'message_1',
        },
      ),
    ).toBe(false);
  });

  it('publishes a connector fixture usable by non-TypeScript validators', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('../fixtures/connector/message-delta.json', import.meta.url), 'utf8'),
    ) as unknown;

    expect(ajv.compile(ConnectorEventSchema)(fixture)).toBe(true);
  });

  it('publishes the planned public API as OpenAPI 3.1', async () => {
    const document = JSON.parse(
      await readFile(new URL('../openapi/openapi.json', import.meta.url), 'utf8'),
    ) as {
      openapi: string;
      paths: Record<string, { post?: { parameters?: Array<{ $ref: string }> } }>;
    };

    expect(document.openapi).toBe('3.1.1');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/v1/sessions',
        '/v1/identity/exchange',
        '/v1/conversations',
        '/v1/conversations/{conversationId}',
        '/v1/conversations/{conversationId}/messages',
        '/v1/conversations/{conversationId}/events',
        '/v1/conversations/{conversationId}/inputs/{requestId}',
        '/v1/conversations/{conversationId}/cancel',
        '/v1/conversations/{conversationId}/retry',
      ]),
    );
    expect(document.paths['/v1/sessions']?.post?.parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });
    expect(document.paths['/v1/identity/exchange']?.post?.parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });

    const externalReferences = JSON.stringify(document).match(/\.\.\/schemas\/[^"#]+/g) ?? [];
    await Promise.all(
      [...new Set(externalReferences)].map((reference) =>
        readFile(new URL(reference, new URL('../openapi/openapi.json', import.meta.url))),
      ),
    );
  });
});
