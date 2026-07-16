import { HaystackConnector } from '@formation-chat-core/haystack-connector';
import { MockConnector } from '@formation-chat-core/mock-connector';
import { describe, expect, it } from 'vitest';

import { createConnectorResolver } from '../src/run/connectors.js';

describe('createConnectorResolver', () => {
  it('resolves only explicitly configured Haystack agent references', () => {
    const resolve = createConnectorResolver({
      connectorMode: 'haystack',
      haystackConnectors: {
        'public-support': {
          baseUrl: 'http://haystack:8080',
          tenantKey: 'formationxyz_com',
          agentSlug: 'support',
        },
      },
    });

    expect(resolve('public-support')).toBeInstanceOf(HaystackConnector);
    expect(resolve('browser-controlled-agent')).toBeUndefined();
  });

  it('preserves disabled and deterministic mock modes', () => {
    expect(
      createConnectorResolver({ connectorMode: 'disabled', haystackConnectors: {} })('agent-1'),
    ).toBeUndefined();
    expect(
      createConnectorResolver({ connectorMode: 'mock', haystackConnectors: {} })('agent-1'),
    ).toBeInstanceOf(MockConnector);
  });
});
