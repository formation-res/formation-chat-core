import type {
  CancelRunResponse,
  ContentPart,
  Conversation,
  Message,
  PublicConversationEvent,
  SessionBootstrapResponse,
  SubmitMessageRequest,
} from '@formation-chat-core/protocol';

export type ChatPhase = 'idle' | 'bootstrapping' | 'ready' | 'streaming' | 'reconnecting' | 'error';

export interface ChatClientError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PublicSession {
  tenantId: string;
  siteId: string;
  principal: SessionBootstrapResponse['principal'];
  sessionId: string;
  expiresAt: string;
}

export interface LiveMessage {
  messageId: string;
  status: 'streaming' | 'completed' | 'failed' | 'cancelled';
  text: string;
  parts: ContentPart[];
}

export interface RunState {
  runId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
  failureCode?: string;
}

export interface ChatState {
  phase: ChatPhase;
  session?: PublicSession;
  conversation?: Conversation;
  messages: Message[];
  liveMessages: Readonly<Record<string, LiveMessage>>;
  run?: RunState;
  lastEventId?: string;
  lastEventSequence: number;
  recentEventIds: readonly string[];
  error?: ChatClientError;
}

export type ChatStateAction =
  | { type: 'phase.changed'; phase: ChatPhase }
  | { type: 'session.loaded'; session: PublicSession }
  | { type: 'snapshot.loaded'; conversation: Conversation; messages: Message[] }
  | { type: 'conversation.cleared' }
  | { type: 'live.cleared' }
  | { type: 'message.submitted'; message: Message }
  | { type: 'run.cancelled'; runId: string; requested: boolean }
  | { type: 'run.retrying' }
  | { type: 'event.received'; event: PublicConversationEvent }
  | { type: 'cursor.restored'; eventId: string; sequence: number }
  | { type: 'cursor.cleared' }
  | { type: 'connection.failed'; error: ChatClientError }
  | { type: 'error.raised'; error: ChatClientError };

export interface PersistedChatState {
  version: 1;
  browserIdentity?: string;
  conversationId?: string;
  lastEventId?: string;
  lastEventSequence?: number;
}

export interface ChatStorage {
  load(siteKey: string): Promise<PersistedChatState | undefined>;
  save(siteKey: string, state: PersistedChatState): Promise<void>;
  subscribe?(
    siteKey: string,
    listener: (state: PersistedChatState | undefined) => void,
  ): () => void;
}

export interface StreamEventsRequest {
  conversationId: string;
  lastEventId?: string;
  signal: AbortSignal;
  onEvent(event: PublicConversationEvent): void | Promise<void>;
}

export interface ChatTransport {
  bootstrap(request: {
    siteKey: string;
    browserIdentity?: string;
    idempotencyKey: string;
  }): Promise<SessionBootstrapResponse>;
  createConversation(idempotencyKey: string): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation>;
  listMessages(conversationId: string): Promise<Message[]>;
  submitMessage(
    conversationId: string,
    request: SubmitMessageRequest,
    idempotencyKey: string,
  ): Promise<Message>;
  cancel(conversationId: string, idempotencyKey: string): Promise<CancelRunResponse>;
  retry(conversationId: string, idempotencyKey: string): Promise<void>;
  streamEvents(request: StreamEventsRequest): Promise<void>;
}

export interface ChatClientOptions {
  siteKey: string;
  transport: ChatTransport;
  storage?: ChatStorage;
  createId?: () => string;
  reconnectDelay?: (attempt: number) => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface ChatClient {
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): () => void;
  start(): Promise<void>;
  createConversation(): Promise<Conversation>;
  selectConversation(conversationId: string): Promise<void>;
  sendMessage(request: SubmitMessageRequest): Promise<Message>;
  cancel(): Promise<CancelRunResponse>;
  retryRun(): Promise<void>;
  retry(): Promise<void>;
  destroy(): void;
}
