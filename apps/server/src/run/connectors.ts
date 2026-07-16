import { HaystackConnector } from '@formation-chat-core/haystack-connector';
import { MockConnector } from '@formation-chat-core/mock-connector';
import type { ChatConnector } from '@formation-chat-core/server-sdk';

import type { ServerConfig } from '../config.js';

type ConnectorConfig = Pick<ServerConfig, 'connectorMode' | 'haystackConnectors'>;
type ConnectorResolver = (agentRef: string) => ChatConnector | undefined;

export function createConnectorResolver(config: ConnectorConfig): ConnectorResolver {
  if (config.connectorMode === 'mock') return () => new MockConnector();
  if (config.connectorMode === 'disabled') return () => undefined;
  const connectors = new Map(
    Object.entries(config.haystackConnectors).map(([agentRef, connectorConfig]) => [
      agentRef,
      new HaystackConnector(connectorConfig),
    ]),
  );
  return (agentRef) => connectors.get(agentRef);
}
