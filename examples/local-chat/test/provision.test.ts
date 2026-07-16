import { describe, expect, it, vi } from 'vitest';

import { provisionLocalChatSite } from '../scripts/provision.mjs';

describe('provisionLocalChatSite', () => {
  it('uses parameterized upserts for the configured tenant and site', async () => {
    const query = vi.fn().mockResolvedValue({});

    await provisionLocalChatSite(
      { query },
      {
        agentRef: 'public-support',
        origin: 'http://127.0.0.1:4173',
        siteId: 'local-site',
        siteKey: 'local-chat',
        tenantId: 'local-tenant',
      },
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(['local-tenant', 'Local development']);
    expect(query.mock.calls[1]?.[1]).toEqual([
      'local-site',
      'local-tenant',
      'local-chat',
      'Local chat',
      JSON.stringify(['http://127.0.0.1:4173']),
      'public-support',
    ]);
    expect(query.mock.calls[1]?.[0]).not.toContain('http://127.0.0.1:4173');
  });
});
