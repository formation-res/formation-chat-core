import type { ChatStorage, PersistedChatState } from './types.js';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StorageEventTargetLike {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

export function createMemoryStorage(): ChatStorage {
  const states = new Map<string, PersistedChatState>();
  const listeners = new Map<string, Set<(state: PersistedChatState | undefined) => void>>();
  return {
    async load(siteKey) {
      return states.get(siteKey);
    },
    async save(siteKey, state) {
      states.set(siteKey, state);
      for (const listener of listeners.get(siteKey) ?? []) listener(state);
    },
    subscribe(siteKey, listener) {
      const siteListeners = listeners.get(siteKey) ?? new Set();
      siteListeners.add(listener);
      listeners.set(siteKey, siteListeners);
      return () => siteListeners.delete(listener);
    },
  };
}

export function createBrowserStorage(
  options: {
    storage?: StorageLike;
    eventTarget?: StorageEventTargetLike;
    keyPrefix?: string;
  } = {},
): ChatStorage {
  const storage = options.storage ?? globalThis.localStorage;
  const eventTarget: StorageEventTargetLike | undefined =
    options.eventTarget ?? (globalThis.window as StorageEventTargetLike | undefined);
  const keyPrefix = options.keyPrefix ?? 'formation-chat-core:';
  const key = (siteKey: string) => `${keyPrefix}${siteKey}`;
  return {
    async load(siteKey) {
      return parsePersisted(storage.getItem(key(siteKey)));
    },
    async save(siteKey, state) {
      storage.setItem(key(siteKey), JSON.stringify(state));
    },
    subscribe(siteKey, listener) {
      if (!eventTarget) return () => undefined;
      const onStorage = (event: StorageEvent) => {
        if (event.key === key(siteKey)) listener(parsePersisted(event.newValue));
      };
      eventTarget.addEventListener('storage', onStorage);
      return () => eventTarget.removeEventListener('storage', onStorage);
    },
  };
}

function parsePersisted(value: string | null): PersistedChatState | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      return undefined;
    }
    const candidate = parsed as Record<string, unknown>;
    for (const field of ['browserIdentity', 'conversationId', 'lastEventId'] as const) {
      if (candidate[field] !== undefined && typeof candidate[field] !== 'string') return undefined;
    }
    if (
      candidate.lastEventSequence !== undefined &&
      (!Number.isSafeInteger(candidate.lastEventSequence) ||
        Number(candidate.lastEventSequence) < 0)
    )
      return undefined;
    return {
      version: 1,
      ...(typeof candidate.browserIdentity === 'string'
        ? { browserIdentity: candidate.browserIdentity }
        : {}),
      ...(typeof candidate.conversationId === 'string'
        ? { conversationId: candidate.conversationId }
        : {}),
      ...(typeof candidate.lastEventId === 'string' ? { lastEventId: candidate.lastEventId } : {}),
      ...(typeof candidate.lastEventSequence === 'number'
        ? { lastEventSequence: candidate.lastEventSequence }
        : {}),
    };
  } catch {
    return undefined;
  }
}
