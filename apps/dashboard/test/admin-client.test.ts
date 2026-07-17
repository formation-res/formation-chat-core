import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminApiError, AdminClient } from '../src/admin-client.js';
import { conversationPage, overview } from './fixtures.js';

afterEach(() => vi.unstubAllGlobals());

describe('AdminClient', () => {
  it('keeps credentials in the authorization header and validates response contracts', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer admin-token');
      if (String(input).endsWith('/v1/admin/overview')) return Response.json(overview);
      return Response.json({ data: [], pagination: { hasMore: false } });
    });
    vi.stubGlobal('fetch', fetch);

    const client = new AdminClient('https://chat.example.com/', 'admin-token');
    await expect(client.getOverview()).resolves.toEqual(overview);
    await expect(client.listConversations({ limit: 20 })).resolves.toEqual({
      data: [],
      pagination: { hasMore: false },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://chat.example.com/v1/admin/overview');
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      'https://chat.example.com/v1/admin/conversations?limit=20',
    );
  });

  it('rejects malformed and unauthorized responses without exposing server details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: 'wrong' })),
    );
    const client = new AdminClient('https://chat.example.com', 'admin-token');
    await expect(client.listRuns({})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'UNAUTHORIZED', message: 'Sensitive upstream detail' } },
          { status: 401 },
        ),
      ),
    );
    await expect(client.listRuns({})).rejects.toEqual(
      new AdminApiError('UNAUTHORIZED', 'Your admin session is not authorized.', 401),
    );
  });

  it('accepts contract-valid timestamped resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(conversationPage)),
    );
    const client = new AdminClient('https://chat.example.com', 'admin-token');
    await expect(client.listConversations({})).resolves.toEqual(conversationPage);
  });

  it('loads the tenant and site overview contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(overview)),
    );
    const client = new AdminClient('https://chat.example.com', 'admin-token');
    await expect(client.getOverview()).resolves.toEqual(overview);
  });
});
