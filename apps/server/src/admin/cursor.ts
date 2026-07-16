type CursorKind = 'conversation' | 'message' | 'event' | 'run' | 'failure' | 'handoff';

interface TimeCursor {
  timestamp: string;
  id: string;
}

export function encodeTimeCursor(kind: CursorKind, timestamp: Date, id: string): string {
  return encode([kind, timestamp.toISOString(), id]);
}

export function decodeTimeCursor(kind: CursorKind, value: string): TimeCursor | undefined {
  const decoded = decode(value);
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 3 ||
    decoded[0] !== kind ||
    typeof decoded[1] !== 'string' ||
    !Number.isFinite(Date.parse(decoded[1])) ||
    typeof decoded[2] !== 'string' ||
    decoded[2].length === 0
  ) {
    return undefined;
  }
  return { timestamp: decoded[1], id: decoded[2] };
}

export function encodeSequenceCursor(kind: 'message' | 'event', sequence: number): string {
  return encode([kind, sequence]);
}

export function decodeSequenceCursor(kind: 'message' | 'event', value: string): number | undefined {
  const decoded = decode(value);
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    decoded[0] !== kind ||
    !Number.isSafeInteger(decoded[1]) ||
    (decoded[1] as number) < 1
  ) {
    return undefined;
  }
  return decoded[1] as number;
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const decode = (value: string): unknown => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};
