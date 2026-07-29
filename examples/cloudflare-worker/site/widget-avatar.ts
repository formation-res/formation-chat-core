export const AVATAR_COLUMNS = 6;
export const AVATARS_PER_SHEET = 36;
export const AGENT_AVATAR_COUNT = AVATARS_PER_SHEET;
export const USER_AVATAR_COUNT = AVATARS_PER_SHEET * 3;

export type AvatarRole = 'agent' | 'user';
export type UserAvatarSheet = 'people' | 'people-alt' | 'animals';

interface AvatarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function avatarStorageKey(widgetStorageKey: string, role: AvatarRole): string {
  return `${widgetStorageKey}:${role}-avatar`;
}

export function selectStoredConversationAvatars(
  storage: AvatarStorage,
  widgetStorageKey: string,
  randomUint32: () => number = browserRandomUint32,
): { agentIndex: number; userIndex: number } {
  return {
    agentIndex: selectStoredAvatarIndex(
      storage,
      avatarStorageKey(widgetStorageKey, 'agent'),
      AGENT_AVATAR_COUNT,
      randomUint32,
    ),
    userIndex: selectStoredAvatarIndex(
      storage,
      avatarStorageKey(widgetStorageKey, 'user'),
      USER_AVATAR_COUNT,
      randomUint32,
    ),
  };
}

export function selectStoredAvatarIndex(
  storage: AvatarStorage,
  key: string,
  count: number,
  randomUint32: () => number = browserRandomUint32,
): number {
  const storedValue = storage.getItem(key);
  const stored = storedValue === null ? Number.NaN : Number(storedValue);
  if (Number.isInteger(stored) && stored >= 0 && stored < count) return stored;

  const selected = Math.abs(Math.trunc(randomUint32())) % count;
  storage.setItem(key, String(selected));
  return selected;
}

export function storeAvatarIndex(
  storage: AvatarStorage,
  widgetStorageKey: string,
  role: AvatarRole,
  index: number,
): void {
  const count = role === 'agent' ? AGENT_AVATAR_COUNT : USER_AVATAR_COUNT;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${role === 'agent' ? 'Agent' : 'User'} avatar index is out of range.`);
  }
  storage.setItem(avatarStorageKey(widgetStorageKey, role), String(index));
}

export function avatarCoordinates(index: number): { column: number; row: number } {
  if (!Number.isInteger(index) || index < 0 || index >= USER_AVATAR_COUNT) {
    throw new RangeError('Avatar index must be between 0 and 107.');
  }
  const cellIndex = index % AVATARS_PER_SHEET;
  return {
    column: cellIndex % AVATAR_COLUMNS,
    row: Math.floor(cellIndex / AVATAR_COLUMNS),
  };
}

export function userAvatarSheet(index: number): {
  sheet: UserAvatarSheet;
  cellIndex: number;
} {
  avatarCoordinates(index);
  if (index < AVATARS_PER_SHEET) return { sheet: 'people', cellIndex: index };
  if (index < AVATARS_PER_SHEET * 2) {
    return { sheet: 'people-alt', cellIndex: index - AVATARS_PER_SHEET };
  }
  return { sheet: 'animals', cellIndex: index - AVATARS_PER_SHEET * 2 };
}

function browserRandomUint32(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] ?? 0;
}
