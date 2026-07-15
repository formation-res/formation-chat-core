import { describe, expect, it } from 'vitest';

import type { ChatConnector, ConnectorCancellationStatus } from '../src/index.js';

describe('connector SDK contract', () => {
  it('supports async event production and explicit cancellation status', async () => {
    const connector: ChatConnector = {
      async *run({ request }) {
        yield {
          type: 'run.started',
          visibility: 'internal',
          conversationId: request.conversationId,
          runId: request.runId,
          data: { agentRef: request.agentRef },
        };
      },
      async cancel(): Promise<ConnectorCancellationStatus> {
        return 'not_supported';
      },
    };

    expect(await connector.cancel?.('run-1')).toBe('not_supported');
  });
});
