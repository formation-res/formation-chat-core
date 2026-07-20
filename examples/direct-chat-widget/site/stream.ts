const MAX_EVENT_FRAME_CHARS = 65_536;

export interface WidgetEvent {
  type: string;
  data: unknown;
}

export async function readEventStream(
  response: Response,
  onEvent: (event: WidgetEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error('The agent returned no event stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  try {
    for (;;) {
      const result = await reader.read();
      buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      buffer = buffer.replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame.length > MAX_EVENT_FRAME_CHARS) throw new Error('Event frame is too large.');
        if (frame.trim()) onEvent(parseFrame(frame));
        boundary = buffer.indexOf('\n\n');
      }
      if (buffer.length > MAX_EVENT_FRAME_CHARS) throw new Error('Event frame is too large.');
      if (result.done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) throw new Error('Invalid event stream.');
}

function parseFrame(frame: string): WidgetEvent {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  try {
    const value: unknown = JSON.parse(data);
    if (!isRecord(value) || typeof value.type !== 'string' || !('data' in value)) throw new Error();
    return { type: value.type, data: value.data };
  } catch {
    throw new Error('Invalid event stream.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
