import {
  AdminConversationListSchema,
  AdminEventListSchema,
  AdminFailureListSchema,
  AdminHandoffListSchema,
  AdminMessageListSchema,
  AdminRunListSchema,
  ConversationSchema,
  type AdminConversationFilter,
  type AdminConversationList,
  type AdminEventList,
  type AdminFailureList,
  type AdminHandoffFilter,
  type AdminHandoffList,
  type AdminMessageList,
  type AdminRunFilter,
  type AdminRunList,
  type Conversation,
} from '@formation-chat-core/protocol';
import { FormatRegistry, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set(
    'date-time',
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
      Number.isFinite(Date.parse(value)),
  );
}
if (!FormatRegistry.Has('uri')) {
  FormatRegistry.Set('uri', (value) => {
    try {
      return Boolean(new URL(value).protocol);
    } catch {
      return false;
    }
  });
}

export interface AdminApi {
  listConversations(
    filters: AdminConversationFilter,
    signal?: AbortSignal,
  ): Promise<AdminConversationList>;
  getConversation(conversationId: string, signal?: AbortSignal): Promise<Conversation>;
  listMessages(
    conversationId: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<AdminMessageList>;
  listEvents(
    conversationId: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<AdminEventList>;
  listRuns(filters: AdminRunFilter, signal?: AbortSignal): Promise<AdminRunList>;
  listFailures(
    filters: Omit<AdminRunFilter, 'status'>,
    signal?: AbortSignal,
  ): Promise<AdminFailureList>;
  listHandoffs(filters: AdminHandoffFilter, signal?: AbortSignal): Promise<AdminHandoffList>;
}

export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export class AdminClient implements AdminApi {
  readonly #baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Use an HTTP or HTTPS Chat Core URL without embedded credentials.');
    }
    this.#baseUrl = url.origin;
  }

  listConversations(filters: AdminConversationFilter, signal?: AbortSignal) {
    return this.#get<AdminConversationList>(
      '/v1/admin/conversations',
      AdminConversationListSchema,
      filters,
      signal,
    );
  }

  getConversation(conversationId: string, signal?: AbortSignal) {
    return this.#get<Conversation>(
      `/v1/admin/conversations/${encodeURIComponent(conversationId)}`,
      ConversationSchema,
      {},
      signal,
    );
  }

  listMessages(conversationId: string, cursor?: string, signal?: AbortSignal) {
    return this.#get<AdminMessageList>(
      `/v1/admin/conversations/${encodeURIComponent(conversationId)}/messages`,
      AdminMessageListSchema,
      { ...(cursor ? { cursor } : {}), limit: 100 },
      signal,
    );
  }

  listEvents(conversationId: string, cursor?: string, signal?: AbortSignal) {
    return this.#get<AdminEventList>(
      `/v1/admin/conversations/${encodeURIComponent(conversationId)}/events`,
      AdminEventListSchema,
      { ...(cursor ? { cursor } : {}), limit: 100 },
      signal,
    );
  }

  listRuns(filters: AdminRunFilter, signal?: AbortSignal) {
    return this.#get<AdminRunList>('/v1/admin/runs', AdminRunListSchema, filters, signal);
  }

  listFailures(filters: Omit<AdminRunFilter, 'status'>, signal?: AbortSignal) {
    return this.#get<AdminFailureList>(
      '/v1/admin/failures',
      AdminFailureListSchema,
      filters,
      signal,
    );
  }

  listHandoffs(filters: AdminHandoffFilter, signal?: AbortSignal) {
    return this.#get<AdminHandoffList>(
      '/v1/admin/handoffs',
      AdminHandoffListSchema,
      filters,
      signal,
    );
  }

  async #get<T>(
    path: string,
    schema: TSchema,
    query: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new AdminApiError('NETWORK_ERROR', 'Chat Core could not be reached.', 0);
    }
    if (!response.ok) throw safeResponseError(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AdminApiError(
        'INVALID_RESPONSE',
        'Chat Core returned an invalid response.',
        response.status,
      );
    }
    if (!Value.Check(schema, payload)) {
      throw new AdminApiError(
        'INVALID_RESPONSE',
        'Chat Core returned an invalid response.',
        response.status,
      );
    }
    return payload as T;
  }
}

function safeResponseError(status: number): AdminApiError {
  if (status === 401 || status === 403) {
    return new AdminApiError('UNAUTHORIZED', 'Your admin session is not authorized.', status);
  }
  if (status === 404)
    return new AdminApiError('NOT_FOUND', 'The requested record was not found.', status);
  if (status === 429)
    return new AdminApiError('RATE_LIMITED', 'Too many requests. Try again shortly.', status);
  return new AdminApiError('REQUEST_FAILED', 'The dashboard request failed.', status);
}
