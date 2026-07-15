import { describe, expect, it, vi } from 'vitest';

import { createBrowserStorage, createMemoryStorage } from '../src/index.js';

describe('browser state storage', () => {
  it('shares updates between memory storage subscribers', async () => {
    const storage = createMemoryStorage();
    const changed = vi.fn();
    storage.subscribe?.('site-a', changed);
    await storage.save('site-a', { version: 1, browserIdentity: 'browser-1' });
    expect(await storage.load('site-a')).toEqual({ version: 1, browserIdentity: 'browser-1' });
    expect(changed).toHaveBeenCalledOnce();
  });

  it('persists only the documented non-secret fields', async () => {
    const values = new Map<string, string>();
    const storage = createBrowserStorage({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
    });
    await storage.save('site-a', {
      version: 1,
      browserIdentity: 'browser-1',
      conversationId: 'conversation-1',
      lastEventId: 'event-1',
      lastEventSequence: 3,
    });
    expect([...values.values()].join('')).not.toContain('accessToken');
    expect(await storage.load('site-a')).toMatchObject({ conversationId: 'conversation-1' });
  });

  it('drops unknown legacy or injected fields while loading', async () => {
    const storage = createBrowserStorage({
      storage: {
        getItem: () =>
          JSON.stringify({ version: 1, browserIdentity: 'browser-1', accessToken: 'secret' }),
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    expect(await storage.load('site-a')).toEqual({ version: 1, browserIdentity: 'browser-1' });
  });
});
