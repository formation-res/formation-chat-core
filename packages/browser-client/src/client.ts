import type {
  CancelRunResponse,
  Conversation,
  CreateEmailHandoffRequest,
  CreateEmailHandoffResponse,
  Message,
  PublicConversationEvent,
  SubmitMessageRequest,
  SubmitStructuredInputRequest,
  StructuredInputRequest,
} from '@formation-chat-core/protocol';

import { initialChatState, reduceChatState } from './state.js';
import { createBrowserStorage, createMemoryStorage } from './storage.js';
import { isAuthenticationError } from './http-transport.js';
import type {
  ChatClient,
  ChatClientError,
  ChatClientOptions,
  ChatTransport,
  ChatState,
  ChatStateAction,
  ChatStorage,
  PersistedChatState,
  PublicSession,
} from './types.js';

export function createChatClient(options: ChatClientOptions): ChatClient {
  const storage = options.storage ?? defaultStorage();
  const createId = options.createId ?? (() => crypto.randomUUID());
  const reconnectDelay =
    options.reconnectDelay ?? ((attempt) => Math.min(1_000 * 2 ** attempt, 30_000));
  const renewalLeadMs = options.renewalLeadMs ?? 60_000;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as number));
  const listeners = new Set<(state: ChatState) => void>();
  let state = initialChatState;
  let persisted: PersistedChatState = { version: 1 };
  let destroyed = false;
  let started = false;
  let streamAbort: AbortController | undefined;
  let reconnectTimer: unknown;
  let renewalTimer: unknown;
  let renewalPromise: Promise<PublicSession> | undefined;
  let reconnectAttempt = 0;
  let ignoreStorage = false;
  let externalUpdate = Promise.resolve();
  const unsubscribeStorage = storage.subscribe?.(options.siteKey, (next) => {
    if (destroyed || ignoreStorage || !next) return;
    externalUpdate = externalUpdate.then(() => applyExternalState(next)).catch(raiseError);
  });
  const unsubscribeLifecycle = subscribeLifecycle(() => {
    void recoverActiveSession().catch(raiseError);
  });

  const dispatch = (action: ChatStateAction) => {
    state = reduceChatState(state, action);
    for (const listener of listeners) listener(state);
  };

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    dispatch({ type: 'phase.changed', phase: 'bootstrapping' });
    try {
      persisted = (await storage.load(options.siteKey)) ?? { version: 1 };
      await bootstrapSession(createId());
      if (persisted.lastEventId) {
        dispatch({
          type: 'cursor.restored',
          eventId: persisted.lastEventId,
          sequence: persisted.lastEventSequence ?? 0,
        });
      }
      await persist();
      if (persisted.conversationId) await loadConversation(persisted.conversationId);
    } catch (error) {
      raiseError(error);
      throw error;
    }
  }

  async function createConversation(): Promise<Conversation> {
    requireStarted();
    const idempotencyKey = createId();
    const conversation = await runCommand(() =>
      options.transport.createConversation(idempotencyKey),
    );
    if (state.conversation?.conversationId !== conversation.conversationId) {
      dispatch({ type: 'conversation.cleared' });
    }
    persisted = { ...withoutCursor(persisted), conversationId: conversation.conversationId };
    dispatch({ type: 'cursor.cleared' });
    dispatch({ type: 'snapshot.loaded', conversation, messages: [] });
    await persist();
    openStream();
    return conversation;
  }

  async function selectConversation(conversationId: string): Promise<void> {
    requireStarted();
    if (persisted.conversationId !== conversationId) {
      persisted = { ...withoutCursor(persisted), conversationId };
      dispatch({ type: 'cursor.cleared' });
    }
    await loadConversation(conversationId);
  }

  async function sendMessage(request: SubmitMessageRequest): Promise<Message> {
    const conversation = requireConversation();
    const idempotencyKey = createId();
    const message = await runCommand(() =>
      options.transport.submitMessage(conversation.conversationId, request, idempotencyKey),
    );
    dispatch({ type: 'message.submitted', message });
    openStream();
    return message;
  }

  async function createEmailHandoff(
    request: CreateEmailHandoffRequest,
  ): Promise<CreateEmailHandoffResponse> {
    const conversation = requireConversation();
    const idempotencyKey = createId();
    const handoff = await runCommand(() =>
      options.transport.createEmailHandoff(conversation.conversationId, request, idempotencyKey),
    );
    openStream();
    return handoff;
  }

  async function cancel(): Promise<CancelRunResponse> {
    const conversation = requireConversation();
    const idempotencyKey = createId();
    const outcome = await runCommand(() =>
      options.transport.cancel(conversation.conversationId, idempotencyKey),
    );
    dispatch({
      type: 'run.cancelled',
      runId: outcome.runId,
      requested: outcome.cancellationStatus === 'cancel_requested',
    });
    return outcome;
  }

  async function submitStructuredInput(
    requestId: string,
    request: SubmitStructuredInputRequest,
  ): Promise<StructuredInputRequest> {
    const conversation = requireConversation();
    if (state.contactRequest?.requestId !== requestId) {
      throw new Error('The structured input request is not active.');
    }
    const idempotencyKey = createId();
    const result = await runCommand(() =>
      options.transport.submitStructuredInput(
        conversation.conversationId,
        requestId,
        request,
        idempotencyKey,
      ),
    );
    dispatch({ type: 'structured-input.submitted', requestId });
    openStream();
    return result;
  }

  async function retryRun(): Promise<void> {
    const conversation = requireConversation();
    const idempotencyKey = createId();
    await runCommand(() => options.transport.retry(conversation.conversationId, idempotencyKey));
    dispatch({ type: 'run.retrying' });
    openStream();
  }

  async function retry(): Promise<void> {
    if (!started) throw new Error('Start the chat client before retrying it.');
    streamAbort?.abort();
    dispatch({ type: 'phase.changed', phase: 'bootstrapping' });
    await runCommand(() => renewSession());
    if (persisted.conversationId) await loadConversation(persisted.conversationId);
  }

  async function loadConversation(conversationId: string): Promise<void> {
    const [conversation, messages] = await Promise.all([
      runAuthenticated(() => options.transport.getConversation(conversationId)),
      runAuthenticated(() => options.transport.listMessages(conversationId)),
    ]);
    if (state.conversation && state.conversation.conversationId !== conversationId) {
      dispatch({ type: 'conversation.cleared' });
    }
    persisted = { ...persisted, conversationId };
    dispatch({ type: 'snapshot.loaded', conversation, messages });
    await persist();
    openStream();
  }

  async function synchronize(): Promise<void> {
    const conversationId = persisted.conversationId;
    if (!conversationId) return;
    const [conversation, messages] = await Promise.all([
      runAuthenticated(() => options.transport.getConversation(conversationId)),
      runAuthenticated(() => options.transport.listMessages(conversationId)),
    ]);
    dispatch({ type: 'snapshot.loaded', conversation, messages });
  }

  function openStream(): void {
    const conversation = state.conversation;
    if (!conversation || destroyed) return;
    streamAbort?.abort();
    if (reconnectTimer !== undefined) clearTimer(reconnectTimer);
    const controller = new AbortController();
    streamAbort = controller;
    const lastEventId = state.lastEventId;
    void streamEvents(controller, {
      conversationId: conversation.conversationId,
      ...(lastEventId ? { lastEventId } : {}),
      signal: controller.signal,
      onEvent: handleEvent,
    })
      .then(() => {
        if (!controller.signal.aborted) scheduleReconnect();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) scheduleReconnect(error);
      });
  }

  async function handleEvent(event: PublicConversationEvent): Promise<void> {
    if (event.type === 'sync.required') {
      persisted = withoutCursor(persisted);
      dispatch({ type: 'cursor.cleared' });
      dispatch({ type: 'live.cleared' });
      await synchronize();
      await persist();
      streamAbort?.abort();
      openStream();
      return;
    }
    dispatch({ type: 'event.received', event });
    persisted = { ...persisted, lastEventId: event.eventId, lastEventSequence: event.sequence };
    if (event.type === 'message.completed' || event.type === 'run.failed') await synchronize();
    await persist();
    reconnectAttempt = 0;
  }

  function scheduleReconnect(cause?: unknown): void {
    if (destroyed) return;
    if (cause) dispatch({ type: 'connection.failed', error: toClientError(cause, true) });
    else dispatch({ type: 'phase.changed', phase: 'reconnecting' });
    reconnectTimer = setTimer(openStream, reconnectDelay(reconnectAttempt++));
  }

  async function streamEvents(
    controller: AbortController,
    request: Parameters<ChatTransport['streamEvents']>[0],
  ): Promise<void> {
    await ensureFreshSession();
    try {
      await options.transport.streamEvents(request);
    } catch (error) {
      if (!controller.signal.aborted && isAuthenticationError(error)) {
        await renewSession();
        if (!controller.signal.aborted) openStream();
        return;
      }
      throw error;
    }
  }

  async function applyExternalState(next: PersistedChatState): Promise<void> {
    const conversationChanged = next.conversationId !== persisted.conversationId;
    const cursorChanged = next.lastEventId !== persisted.lastEventId;
    persisted = next;
    if (!state.session) return;
    if (conversationChanged) {
      if (next.conversationId) await loadConversation(next.conversationId);
      else {
        streamAbort?.abort();
        dispatch({ type: 'conversation.cleared' });
      }
      return;
    }
    if (cursorChanged && next.conversationId && state.session) {
      await synchronize();
      if (next.lastEventId) {
        dispatch({
          type: 'cursor.restored',
          eventId: next.lastEventId,
          sequence: next.lastEventSequence ?? state.lastEventSequence,
        });
      }
    }
  }

  async function persist(): Promise<void> {
    ignoreStorage = true;
    try {
      await storage.save(options.siteKey, persisted);
    } finally {
      ignoreStorage = false;
    }
  }

  async function runCommand<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await runAuthenticated(command);
    } catch (error) {
      raiseError(error);
      throw error;
    }
  }

  async function runAuthenticated<T>(command: () => Promise<T>): Promise<T> {
    await ensureFreshSession();
    try {
      return await command();
    } catch (error) {
      if (!isAuthenticationError(error)) throw error;
      await renewSession();
      return command();
    }
  }

  async function ensureFreshSession(): Promise<void> {
    if (!started || destroyed || !state.session) return;
    if (Date.parse(state.session.expiresAt) - Date.now() > renewalLeadMs) return;
    await renewSession();
  }

  async function recoverActiveSession(): Promise<void> {
    await ensureFreshSession();
    if (!destroyed && state.conversation) openStream();
  }

  async function renewSession(): Promise<PublicSession> {
    if (renewalPromise) return renewalPromise;
    if (!persisted.browserIdentity) {
      throw new Error('Cannot renew the chat session before browser identity is available.');
    }
    renewalPromise = bootstrapSession(createId()).finally(() => {
      renewalPromise = undefined;
    });
    return renewalPromise;
  }

  async function bootstrapSession(idempotencyKey: string): Promise<PublicSession> {
    const session = await options.transport.bootstrap({
      siteKey: options.siteKey,
      ...(persisted.browserIdentity ? { browserIdentity: persisted.browserIdentity } : {}),
      idempotencyKey,
    });
    persisted = {
      ...persisted,
      ...(session.browserIdentity ? { browserIdentity: session.browserIdentity } : {}),
    };
    const publicValue = publicSession(session);
    dispatch({ type: 'session.loaded', session: publicValue });
    await persist();
    scheduleRenewal(publicValue);
    return publicValue;
  }

  function scheduleRenewal(session: PublicSession): void {
    if (renewalTimer !== undefined) clearTimer(renewalTimer);
    const delay = Math.max(0, Date.parse(session.expiresAt) - Date.now() - renewalLeadMs);
    renewalTimer = setTimer(() => {
      void renewSession().catch(raiseError);
    }, delay);
  }

  function raiseError(error: unknown): void {
    dispatch({ type: 'error.raised', error: toClientError(error, true) });
  }

  function destroy(): void {
    destroyed = true;
    streamAbort?.abort();
    if (reconnectTimer !== undefined) clearTimer(reconnectTimer);
    if (renewalTimer !== undefined) clearTimer(renewalTimer);
    unsubscribeStorage?.();
    unsubscribeLifecycle();
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    createConversation,
    selectConversation,
    sendMessage,
    createEmailHandoff,
    submitStructuredInput,
    cancel,
    retryRun,
    retry,
    destroy,
  };

  function requireStarted(): void {
    if (!started || !state.session) throw new Error('Start the chat client before using it.');
  }

  function requireConversation(): Conversation {
    requireStarted();
    if (!state.conversation) throw new Error('Select or create a conversation first.');
    return state.conversation;
  }
}

function publicSession(
  session: Awaited<ReturnType<ChatClientOptions['transport']['bootstrap']>>,
): PublicSession {
  return {
    tenantId: session.tenantId,
    siteId: session.siteId,
    principal: session.principal,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
  };
}

function withoutCursor(state: PersistedChatState): PersistedChatState {
  const rest = { ...state };
  delete rest.lastEventId;
  delete rest.lastEventSequence;
  return rest;
}

function defaultStorage(): ChatStorage {
  return typeof globalThis.localStorage === 'undefined'
    ? createMemoryStorage()
    : createBrowserStorage();
}

function subscribeLifecycle(callback: () => void): () => void {
  const subscriptions: Array<() => void> = [];
  const target = globalThis as EventTarget & {
    addEventListener?: EventTarget['addEventListener'];
    removeEventListener?: EventTarget['removeEventListener'];
    document?: Document;
  };
  const subscribe = (
    eventTarget: EventTarget | undefined,
    eventName: string,
    listener: EventListener,
  ) => {
    if (
      !eventTarget ||
      typeof eventTarget.addEventListener !== 'function' ||
      typeof eventTarget.removeEventListener !== 'function'
    ) {
      return;
    }
    eventTarget.addEventListener(eventName, listener);
    subscriptions.push(() => eventTarget.removeEventListener(eventName, listener));
  };

  subscribe(target, 'focus', callback);
  subscribe(target, 'online', callback);
  subscribe(target.document, 'visibilitychange', () => {
    if (target.document?.visibilityState === 'visible') callback();
  });

  return () => {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  };
}

function toClientError(error: unknown, retryable: boolean): ChatClientError {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'CLIENT_ERROR';
    const canRetry =
      'retryable' in error && typeof error.retryable === 'boolean' ? error.retryable : retryable;
    return { code, message: error.message, retryable: canRetry };
  }
  return { code: 'CLIENT_ERROR', message: 'The chat request failed.', retryable };
}
