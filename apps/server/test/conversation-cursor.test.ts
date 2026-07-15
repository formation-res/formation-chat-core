import { describe, expect, it } from 'vitest';

import { decodeConversationCursor, encodeConversationCursor } from '../src/conversation/cursor.js';

describe('conversation cursor', () => {
  it('round-trips an ordered conversation position', () => {
    const position = {
      createdAt: '2026-07-15T12:00:00.000Z',
      conversationId: 'conversation-1',
    };
    expect(decodeConversationCursor(encodeConversationCursor(position))).toEqual(position);
  });

  it('rejects malformed cursor input', () => {
    expect(decodeConversationCursor('bm90LWpzb24')).toBeUndefined();
    expect(
      decodeConversationCursor(Buffer.from(JSON.stringify(['invalid', 1])).toString('base64url')),
    ).toBeUndefined();
  });
});
