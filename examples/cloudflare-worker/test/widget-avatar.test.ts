import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_AVATAR_COUNT,
  USER_AVATAR_COUNT,
  avatarCoordinates,
  avatarStorageKey,
  selectStoredConversationAvatars,
  selectStoredAvatarIndex,
  storeAvatarIndex,
  userAvatarSheet,
} from '../site/widget-avatar.js';

describe('widget session avatar selection', () => {
  it('selects independent agent and visitor portraits for a new conversation', () => {
    const storage = memoryStorage();
    const randomValues = [3, 107];

    expect(
      selectStoredConversationAvatars(storage, 'widget-session', () => randomValues.shift() ?? 0),
    ).toEqual({
      agentIndex: 3,
      userIndex: 107,
    });
    expect(storage.getItem('widget-session:agent-avatar')).toBe('3');
    expect(storage.getItem('widget-session:user-avatar')).toBe('107');
    expect(AGENT_AVATAR_COUNT).toBe(36);
    expect(USER_AVATAR_COUNT).toBe(108);
  });

  it('reuses both stored selections after reload', () => {
    const storage = memoryStorage([
      ['widget-session:agent-avatar', '12'],
      ['widget-session:user-avatar', '28'],
    ]);
    const random = vi.fn(() => 4);

    expect(selectStoredConversationAvatars(storage, 'widget-session', random)).toEqual({
      agentIndex: 12,
      userIndex: 28,
    });
    expect(random).not.toHaveBeenCalled();
  });

  it('stores one of 36 random avatars for the current widget session', () => {
    const storage = memoryStorage();

    expect(selectStoredAvatarIndex(storage, 'avatar-key', AGENT_AVATAR_COUNT, () => 71)).toBe(35);
    expect(storage.getItem('avatar-key')).toBe('35');
    expect(AGENT_AVATAR_COUNT).toBe(36);
  });

  it('reuses the stored avatar instead of choosing again after reload', () => {
    const storage = memoryStorage([['avatar-key', '17']]);
    const random = vi.fn(() => 4);

    expect(selectStoredAvatarIndex(storage, 'avatar-key', AGENT_AVATAR_COUNT, random)).toBe(17);
    expect(random).not.toHaveBeenCalled();
  });

  it('replaces an invalid stored value with a valid random avatar', () => {
    const storage = memoryStorage([['avatar-key', '99']]);

    expect(selectStoredAvatarIndex(storage, 'avatar-key', AGENT_AVATAR_COUNT, () => 41)).toBe(5);
    expect(storage.getItem('avatar-key')).toBe('5');
  });

  it('stores a visitor-selected avatar and rejects invalid gallery indexes', () => {
    const storage = memoryStorage();

    storeAvatarIndex(storage, 'widget-session', 'user', 24);
    expect(storage.getItem('widget-session:user-avatar')).toBe('24');
    storeAvatarIndex(storage, 'widget-session', 'user', 107);
    expect(storage.getItem('widget-session:user-avatar')).toBe('107');
    expect(() => storeAvatarIndex(storage, 'widget-session', 'agent', 36)).toThrow(RangeError);
    expect(() => storeAvatarIndex(storage, 'widget-session', 'user', 108)).toThrow(RangeError);
  });

  it('maps flat user selections onto cells in three 6 by 6 sheets', () => {
    expect(avatarCoordinates(0)).toEqual({ column: 0, row: 0 });
    expect(avatarCoordinates(35)).toEqual({ column: 5, row: 5 });
    expect(avatarCoordinates(36)).toEqual({ column: 0, row: 0 });
    expect(avatarCoordinates(107)).toEqual({ column: 5, row: 5 });
    expect(userAvatarSheet(0)).toEqual({ sheet: 'people', cellIndex: 0 });
    expect(userAvatarSheet(36)).toEqual({ sheet: 'people-alt', cellIndex: 0 });
    expect(userAvatarSheet(72)).toEqual({ sheet: 'animals', cellIndex: 0 });
    expect(userAvatarSheet(107)).toEqual({ sheet: 'animals', cellIndex: 35 });
  });

  it('scopes each profile beside the persisted widget session', () => {
    expect(avatarStorageKey('formation-chat-widget:main-chat:support', 'agent')).toBe(
      'formation-chat-widget:main-chat:support:agent-avatar',
    );
    expect(avatarStorageKey('formation-chat-widget:main-chat:support', 'user')).toBe(
      'formation-chat-widget:main-chat:support:user-avatar',
    );
  });
});

function memoryStorage(initial: Array<[string, string]> = []) {
  const values = new Map(initial);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
