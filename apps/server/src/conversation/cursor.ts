export interface ConversationCursor {
  createdAt: string;
  conversationId: string;
}

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.conversationId])).toString(
    'base64url',
  );
}

export function decodeConversationCursor(value: string): ConversationCursor | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      !Number.isFinite(Date.parse(decoded[0])) ||
      typeof decoded[1] !== 'string'
    ) {
      return undefined;
    }
    return { createdAt: decoded[0], conversationId: decoded[1] };
  } catch {
    return undefined;
  }
}
