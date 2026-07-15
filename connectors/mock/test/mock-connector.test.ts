import { describe, expect, it } from 'vitest';

import { MockConnector } from '../src/index.js';

const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
};

const execution = {
  request: {
    runId: 'run-1',
    conversationId: 'conversation-1',
    agentRef: 'agent-1',
    currentMessage: {
      messageId: 'user-message-1',
      conversationId: 'conversation-1',
      sequence: 1,
      participantId: 'user-1',
      role: 'user' as const,
      status: 'completed' as const,
      parts: [{ type: 'text' as const, text: 'Hello' }],
      createdAt: '2026-07-15T12:00:00.000Z',
      completedAt: '2026-07-15T12:00:00.000Z',
    },
    userParticipantId: 'user-1',
    history: [],
    principalContext: {
      principalId: 'principal-1',
      kind: 'anonymous' as const,
    },
    trustedMetadata: {},
  },
  assistantMessageId: 'assistant-message-1',
  signal: new AbortController().signal,
};

describe('MockConnector', () => {
  it('emits deterministic tool, citation, text, and completion events', async () => {
    const connector = new MockConnector({ responseText: 'A deterministic answer.', chunks: 2 });

    const events = await collect(connector.run(execution));

    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'message.started',
      'tool.started',
      'tool.completed',
      'citation.added',
      'message.delta',
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
    expect(events.at(-2)).toMatchObject({
      type: 'message.completed',
      data: { parts: [{ type: 'text', text: 'A deterministic answer.' }] },
    });
  });

  it('emits a configured failure without completing a message', async () => {
    const connector = new MockConnector({ scenario: 'failure', failureCode: 'MOCK_FAILURE' });

    const events = await collect(connector.run(execution));

    expect(events.map(({ type }) => type)).toEqual(['run.started', 'run.failed']);
    expect(events.at(-1)).toMatchObject({ data: { code: 'MOCK_FAILURE' } });
  });

  it('reports best-effort cancellation when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const connector = new MockConnector();

    expect(await connector.cancel()).toBe('accepted');
    await expect(
      collect(connector.run({ ...execution, signal: controller.signal })),
    ).resolves.toEqual([]);
  });
});
