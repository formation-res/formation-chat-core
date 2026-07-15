import type { ConnectorEvent, ConnectorRunRequest } from '@formation-chat-core/protocol';

export interface ConnectorExecution {
  request: ConnectorRunRequest;
  assistantMessageId: string;
  signal: AbortSignal;
}

export type ConnectorCancellationStatus = 'accepted' | 'not_supported' | 'already_finished';

export interface ChatConnector {
  run(execution: ConnectorExecution): AsyncIterable<ConnectorEvent>;
  cancel?(runId: string): Promise<ConnectorCancellationStatus>;
}
