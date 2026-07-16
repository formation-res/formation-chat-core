import type { ConnectorEvent } from '@formation-chat-core/protocol';
import type { ConnectorExecution } from '@formation-chat-core/server-sdk';
import { describe, expect, it, vi } from 'vitest';

import { HaystackConnector } from '../src/index.js';

const execution = (): ConnectorExecution => ({
  assistantMessageId: 'assistant-message-1',
  signal: new AbortController().signal,
  request: {
    runId: 'run-1',
    conversationId: 'conversation-1',
    agentRef: 'public-support',
    currentMessage: {
      messageId: 'user-message-1',
      conversationId: 'conversation-1',
      sequence: 1,
      participantId: 'user-participant-1',
      role: 'user',
      status: 'completed',
      parts: [{ type: 'text', text: 'Where is my shipment?' }],
      createdAt: '2026-07-16T08:00:00.000Z',
      completedAt: '2026-07-16T08:00:00.000Z',
    },
    userParticipantId: 'user-participant-1',
    history: [
      {
        messageId: 'user-message-1',
        conversationId: 'conversation-1',
        sequence: 1,
        participantId: 'user-participant-1',
        role: 'user',
        status: 'completed',
        parts: [{ type: 'text', text: 'Where is my shipment?' }],
        createdAt: '2026-07-16T08:00:00.000Z',
        completedAt: '2026-07-16T08:00:00.000Z',
      },
    ],
    principalContext: { kind: 'anonymous', principalId: 'principal-1' },
    resolvedInputs: [],
    trustedMetadata: { origin: 'https://www.example.com' },
  },
});

describe('HaystackConnector', () => {
  it('maps trusted configuration and correlation IDs onto the current Haystack request', async () => {
    let received: Request | undefined;
    const fetch = vi.fn(async (request: Request) => {
      received = request;
      return Response.json(successResponse());
    });
    const connector = new HaystackConnector(
      {
        baseUrl: 'http://haystack:8080',
        tenantKey: 'formationxyz_com',
        agentSlug: 'support',
        responseMode: 'info_chat',
      },
      { fetch },
    );

    await collect(connector.run(execution()));

    expect(received?.url).toBe('http://haystack:8080/api/agents/knowledge/chat');
    expect(await received?.json()).toEqual({
      channel: 'web',
      tenant_key: 'formationxyz_com',
      agent_slug: 'support',
      user_id: 'principal-1',
      thread_id: 'conversation-1',
      text: 'Where is my shipment?',
      response_mode: 'info_chat',
      metadata: {
        chat_core: {
          compatibility_mode: 'duplicate_history',
          run_id: 'run-1',
          message_id: 'user-message-1',
          assistant_message_id: 'assistant-message-1',
          conversation_id: 'conversation-1',
          agent_ref: 'public-support',
          origin: 'https://www.example.com',
        },
      },
    });
  });

  it('translates text, tools, citations, and handoff metadata into generic events', async () => {
    const connector = connectorReturning(successResponse());

    const events = await collect(connector.run(execution()));

    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'message.started',
      'tool.started',
      'tool.completed',
      'citation.added',
      'message.delta',
      'message.completed',
      'handoff.requested',
      'run.completed',
    ]);
    expect(events.find(({ type }) => type === 'citation.added')).toMatchObject({
      visibility: 'public',
      data: {
        sourceId: 'sla-document',
        title: 'Shipment SLA',
        url: 'https://northwind.example/sla',
      },
    });
    expect(events.find(({ type }) => type === 'message.completed')).toMatchObject({
      data: {
        parts: [
          { type: 'text', text: 'Your shipment is in transit.' },
          { type: 'citation', sourceId: 'sla-document', title: 'Shipment SLA' },
        ],
      },
    });
    expect(events.find(({ type }) => type === 'handoff.requested')).toMatchObject({
      data: { handoffId: 'run-1' },
    });
  });

  it('emits a failed run without starting a message when Haystack times out', async () => {
    const fetch = vi.fn(
      (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason));
        }),
    );
    const connector = new HaystackConnector(
      {
        baseUrl: 'http://haystack:8080',
        tenantKey: 'formationxyz_com',
        agentSlug: 'support',
        timeoutMs: 5,
      },
      { fetch },
    );

    const events = await collect(connector.run(execution()));

    expect(events.map(({ type }) => type)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({ data: { code: 'HAYSTACK_TIMEOUT' } });
  });

  it('emits a failed run without starting a message for an invalid response', async () => {
    const connector = connectorReturning({ status: 'completed', metadata: {} });

    const events = await collect(connector.run(execution()));

    expect(events.map(({ type }) => type)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({ data: { code: 'HAYSTACK_INVALID_RESPONSE' } });
  });

  it('classifies malformed JSON as an invalid response rather than an outage', async () => {
    const connector = new HaystackConnector(
      {
        baseUrl: 'http://haystack:8080',
        tenantKey: 'formationxyz_com',
        agentSlug: 'support',
      },
      {
        fetch: async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      },
    );

    const events = await collect(connector.run(execution()));

    expect(events.map(({ type }) => type)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({ data: { code: 'HAYSTACK_INVALID_RESPONSE' } });
  });

  it('rejects aggregate user text outside the Haystack request contract before fetch', async () => {
    const fetch = vi.fn(async () => Response.json(successResponse()));
    const connector = new HaystackConnector(
      {
        baseUrl: 'http://haystack:8080',
        tenantKey: 'formationxyz_com',
        agentSlug: 'support',
      },
      { fetch },
    );
    const oversized = execution();
    oversized.request.currentMessage.parts = [
      { type: 'text', text: 'x'.repeat(60_000) },
      { type: 'text', text: 'y'.repeat(60_000) },
    ];

    const events = await collect(connector.run(oversized));

    expect(events.map(({ type }) => type)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({ data: { code: 'HAYSTACK_INVALID_REQUEST' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps non-completed Haystack statuses to a failed run', async () => {
    const connector = connectorReturning({ ...successResponse(), status: 'rejected' });

    const events = await collect(connector.run(execution()));

    expect(events.map(({ type }) => type)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({ data: { code: 'HAYSTACK_REJECTED' } });
  });

  it('rejects invalid or credential-bearing endpoint configuration', () => {
    expect(
      () =>
        new HaystackConnector({
          baseUrl: 'https://user:password@haystack.example.com',
          tenantKey: 'formationxyz_com',
          agentSlug: 'support',
        }),
    ).toThrow('Invalid Haystack connector configuration.');
  });
});

const connectorReturning = (body: unknown) =>
  new HaystackConnector(
    {
      baseUrl: 'http://haystack:8080',
      tenantKey: 'formationxyz_com',
      agentSlug: 'support',
    },
    { fetch: async () => Response.json(body) },
  );

const collect = async (events: AsyncIterable<ConnectorEvent>): Promise<ConnectorEvent[]> => {
  const collected: ConnectorEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

const successResponse = () => ({
  request_id: 'haystack-request-1',
  tenant_key: 'formationxyz_com',
  agent_slug: 'support',
  channel: 'web',
  thread_id: 'conversation-1',
  text: 'Your shipment is in transit.',
  status: 'completed',
  metadata: {
    used_tools: ['querylight_knowledge_base'],
    rag_sources: [
      {
        id: 'sla-document',
        title: 'Shipment SLA',
        content: 'Shipments are normally delivered within two business days.',
        source_path: 'https://northwind.example/sla',
      },
    ],
    handoff: { requested: true, reason: 'Customer requested an operator.' },
  },
});
