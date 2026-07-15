import type { ConnectorEvent } from '@formation-chat-core/protocol';
import type {
  ChatConnector,
  ConnectorCancellationStatus,
  ConnectorExecution,
} from '@formation-chat-core/server-sdk';

export interface MockConnectorOptions {
  scenario?: 'success' | 'failure';
  responseText?: string;
  chunks?: number;
  failureCode?: string;
}

export class MockConnector implements ChatConnector {
  private readonly options: Required<MockConnectorOptions>;

  constructor(options: MockConnectorOptions = {}) {
    this.options = {
      scenario: options.scenario ?? 'success',
      responseText: options.responseText ?? 'This is a deterministic mock response.',
      chunks: options.chunks ?? 3,
      failureCode: options.failureCode ?? 'MOCK_CONNECTOR_FAILURE',
    };
    if (!Number.isSafeInteger(this.options.chunks) || this.options.chunks < 1) {
      throw new RangeError('chunks must be a positive safe integer.');
    }
  }

  async *run(execution: ConnectorExecution): AsyncIterable<ConnectorEvent> {
    if (execution.signal.aborted) return;
    const base = {
      visibility: 'public' as const,
      conversationId: execution.request.conversationId,
      runId: execution.request.runId,
    };
    yield {
      ...base,
      type: 'run.started',
      data: { agentRef: execution.request.agentRef },
    };
    if (this.options.scenario === 'failure') {
      yield { ...base, type: 'run.failed', data: { code: this.options.failureCode } };
      return;
    }

    const message = { ...base, messageId: execution.assistantMessageId };
    yield { ...message, type: 'message.started', data: { role: 'assistant' } };
    yield {
      ...message,
      type: 'tool.started',
      data: { toolCallId: 'mock-tool-1', label: 'Mock knowledge lookup' },
    };
    yield { ...message, type: 'tool.completed', data: { toolCallId: 'mock-tool-1' } };
    yield {
      ...message,
      type: 'citation.added',
      data: {
        citationId: 'mock-citation-1',
        sourceId: 'mock-source-1',
        title: 'Deterministic mock source',
        url: 'https://example.com/mock-source',
      },
    };
    for (const delta of splitText(this.options.responseText, this.options.chunks)) {
      if (execution.signal.aborted) return;
      yield { ...message, type: 'message.delta', data: { delta } };
    }
    yield {
      ...message,
      type: 'message.completed',
      data: { parts: [{ type: 'text', text: this.options.responseText }] },
    };
    yield { ...base, type: 'run.completed', data: {} };
  }

  async cancel(): Promise<ConnectorCancellationStatus> {
    return 'accepted';
  }
}

function splitText(text: string, requestedChunks: number): string[] {
  const characters = Array.from(text);
  const chunkCount = Math.min(requestedChunks, characters.length);
  if (chunkCount === 0) return [];
  const size = Math.ceil(characters.length / chunkCount);
  return Array.from({ length: chunkCount }, (_, index) =>
    characters.slice(index * size, (index + 1) * size).join(''),
  ).filter(Boolean);
}
