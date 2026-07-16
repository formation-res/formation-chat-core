import { describe, expect, it } from 'vitest';

import { loadLocalChatConfig } from '../scripts/config.mjs';

describe('loadLocalChatConfig', () => {
  it('provides a safe loopback configuration for local development', () => {
    expect(loadLocalChatConfig({})).toEqual({
      agentRef: 'public-support',
      coreBaseUrl: new URL('http://127.0.0.1:3000'),
      connectorMode: 'mock',
      dashboardOrigin: 'http://127.0.0.1:4174',
      dashboardPort: 4174,
      databaseUrl: 'postgresql://chat_core:chat_core@127.0.0.1:5432/chat_core',
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:4173',
      port: 4173,
      siteId: 'local-site',
      siteKey: 'local-chat',
      tenantId: 'local-tenant',
    });
  });

  it('rejects invalid IDs and core URLs with paths', () => {
    expect(() => loadLocalChatConfig({ LOCAL_CHAT_SITE_KEY: 'contains spaces' })).toThrow(
      'LOCAL_CHAT_SITE_KEY',
    );
    expect(() => loadLocalChatConfig({ LOCAL_CHAT_CORE_URL: 'http://127.0.0.1:3000/v1' })).toThrow(
      'LOCAL_CHAT_CORE_URL',
    );
    expect(() => loadLocalChatConfig({ LOCAL_CHAT_CONNECTOR_MODE: 'disabled' })).toThrow(
      'LOCAL_CHAT_CONNECTOR_MODE',
    );
  });
});
