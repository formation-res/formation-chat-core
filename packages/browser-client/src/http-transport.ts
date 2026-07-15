import {
  CancelRunResponseSchema,
  ConversationSchema,
  MessageListSchema,
  MessageSchema,
  PublicConversationEventSchema,
  SessionBootstrapResponseSchema,
  SubmitMessageRequestSchema,
  type Message,
  type PublicConversationEvent,
  type SessionBootstrapResponse,
} from '@formation-chat-core/protocol';
import { FormatRegistry, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { ChatClientError, ChatTransport, StreamEventsRequest } from './types.js';

export interface HttpChatTransportOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  origin?: string;
  maxSseFrameBytes?: number;
  maxPaginationRequests?: number;
}

export class HttpChatError extends Error implements ChatClientError {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'HttpChatError';
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export function createHttpChatTransport(options: HttpChatTransportOptions): ChatTransport {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchAdapter = options.fetch ?? globalThis.fetch;
  const maxPaginationRequests = options.maxPaginationRequests ?? 1_000;
  let accessToken: string | undefined;

  async function bootstrap(request: {
    siteKey: string;
    browserIdentity?: string;
    idempotencyKey: string;
  }): Promise<SessionBootstrapResponse> {
    const result = await requestJson(
      '/v1/sessions',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': request.idempotencyKey,
          ...(options.origin ? { Origin: options.origin } : {}),
        },
        body: JSON.stringify({
          siteKey: request.siteKey,
          ...(request.browserIdentity ? { browserIdentity: request.browserIdentity } : {}),
        }),
      },
      SessionBootstrapResponseSchema,
      false,
    );
    accessToken = result.accessToken;
    return result;
  }

  async function requestJson<T extends TSchema>(
    path: string,
    init: RequestInit,
    schema: T,
    authenticated = true,
  ): Promise<Static<T>> {
    const response = await fetchAdapter(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(authenticated ? authorizationHeader(accessToken) : {}),
        ...init.headers,
      },
    });
    const value = await readJson(response);
    if (!response.ok) throw httpError(response, value);
    return validate(schema, value, path);
  }

  async function listMessages(conversationId: string): Promise<Message[]> {
    const messages: Message[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let pageNumber = 0; pageNumber < maxPaginationRequests; pageNumber += 1) {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const page = await requestJson(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
        { method: 'GET' },
        MessageListSchema,
      );
      messages.push(...page.data);
      if (!page.pagination.hasMore) return canonicalMessages(messages);
      cursor = page.pagination.nextCursor;
      if (seenCursors.has(cursor))
        throw new Error('Message pagination returned a repeated cursor.');
      seenCursors.add(cursor);
    }
    throw new Error('Message pagination exceeded the configured request limit.');
  }

  async function streamEvents(request: StreamEventsRequest): Promise<void> {
    const response = await fetchAdapter(
      `${baseUrl}/v1/conversations/${encodeURIComponent(request.conversationId)}/events`,
      {
        method: 'GET',
        signal: request.signal,
        headers: {
          Accept: 'text/event-stream',
          ...authorizationHeader(accessToken),
          ...(request.lastEventId ? { 'Last-Event-ID': request.lastEventId } : {}),
        },
      },
    );
    if (!response.ok) throw httpError(response, await readJson(response));
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      throw new Error('Event stream response has an invalid content type.');
    }
    if (!response.body) throw new Error('Event stream response has no body.');
    await parseEventStream(response.body, request.onEvent, {
      ...(options.maxSseFrameBytes === undefined
        ? {}
        : { maxFrameBytes: options.maxSseFrameBytes }),
    });
  }

  return {
    bootstrap,
    createConversation: (idempotencyKey) =>
      requestJson(
        '/v1/conversations',
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: '{}' },
        ConversationSchema,
      ),
    getConversation: (conversationId) =>
      requestJson(
        `/v1/conversations/${encodeURIComponent(conversationId)}`,
        { method: 'GET' },
        ConversationSchema,
      ),
    listMessages,
    submitMessage: (conversationId, request, idempotencyKey) => {
      validate(SubmitMessageRequestSchema, request, 'message request');
      return requestJson(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(request),
        },
        MessageSchema,
      );
    },
    cancel: (conversationId, idempotencyKey) =>
      requestJson(
        `/v1/conversations/${encodeURIComponent(conversationId)}/cancel`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: '{}' },
        CancelRunResponseSchema,
      ),
    async retry(conversationId, idempotencyKey) {
      const response = await fetchAdapter(
        `${baseUrl}/v1/conversations/${encodeURIComponent(conversationId)}/retry`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...authorizationHeader(accessToken),
            'Idempotency-Key': idempotencyKey,
          },
          body: '{}',
        },
      );
      if (!response.ok) throw httpError(response, await readJson(response));
    },
    streamEvents,
  };
}

export async function parseEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: PublicConversationEvent) => void | Promise<void>,
  options: { maxFrameBytes?: number } = {},
): Promise<void> {
  const maxFrameBytes = options.maxFrameBytes ?? 1_048_576;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let frameBytes = 0;
  let eventId = '';
  let eventType = '';
  let dataLines: string[] = [];

  const dispatch = async () => {
    if (dataLines.length === 0) return reset();
    const raw = dataLines.join('\n');
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Event stream contains invalid JSON.');
    }
    const event = validate(
      PublicConversationEventSchema,
      value,
      'event stream',
    ) as PublicConversationEvent;
    if (!eventId || !eventType || event.eventId !== eventId || event.type !== eventType) {
      throw new Error('Event stream framing does not match its event envelope.');
    }
    reset();
    await onEvent(event);
  };
  const reset = () => {
    eventId = '';
    eventType = '';
    dataLines = [];
    frameBytes = 0;
  };
  const consumeLine = async (line: string) => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') eventId = value;
    else if (field === 'event') eventType = value;
    else if (field === 'data') dataLines.push(value);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      frameBytes += value.byteLength;
      if (frameBytes > maxFrameBytes)
        throw new Error('Event stream frame exceeds the maximum size.');
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        await consumeLine(line);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer) await consumeLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    if (dataLines.length > 0) await dispatch();
  } finally {
    reader.releaseLock();
  }
}

function authorizationHeader(accessToken: string | undefined): Record<string, string> {
  if (!accessToken) throw new Error('Bootstrap is required before authenticated requests.');
  return { Authorization: `Bearer ${accessToken}` };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} response contains invalid JSON.`);
  }
}

function httpError(response: Response, value: unknown): HttpChatError {
  const error =
    value && typeof value === 'object' && 'error' in value
      ? (value as { error?: unknown }).error
      : undefined;
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return new HttpChatError(
    typeof record.code === 'string' ? record.code : `HTTP_${response.status}`,
    typeof record.message === 'string' ? record.message : 'The chat service request failed.',
    response.status,
    typeof record.correlationId === 'string' ? record.correlationId : undefined,
  );
}

function validate<T extends TSchema>(schema: T, value: unknown, boundary: string): Static<T> {
  registerFormats();
  if (!Value.Check(schema, value)) throw new Error(`Invalid ${boundary} response.`);
  return value as Static<T>;
}

function registerFormats(): void {
  if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', (value) => !Number.isNaN(Date.parse(value)));
  }
  if (!FormatRegistry.Has('uri')) {
    FormatRegistry.Set('uri', (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    });
  }
  if (!FormatRegistry.Has('email')) {
    FormatRegistry.Set('email', (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  }
}

function canonicalMessages(messages: Message[]): Message[] {
  return [...new Map(messages.map((message) => [message.messageId, message])).values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError('baseUrl must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}
