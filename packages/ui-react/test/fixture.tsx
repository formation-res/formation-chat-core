import type { ChatClient, ChatState } from '@formation-chat-core/browser-client';
import type {
  Conversation,
  Message,
  StructuredInputRequest,
  SubmitMessageRequest,
} from '@formation-chat-core/protocol';
import axe from 'axe-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ChatPanel } from '../src/index.js';
import './fixture.css';

const now = '2026-07-15T10:00:00.000Z';
const conversation: Conversation = {
  conversationId: 'browser-conversation',
  tenantId: 'browser-tenant',
  siteId: 'browser-site',
  principalId: 'browser-principal',
  agentRef: 'mock-agent',
  status: 'active',
  participants: [
    { participantId: 'browser-user', kind: 'user', principalId: 'browser-principal' },
    { participantId: 'browser-agent', kind: 'agent', agentRef: 'mock-agent' },
  ],
  createdAt: now,
  updatedAt: now,
};

class BrowserFixtureClient implements ChatClient {
  private state: ChatState;
  private readonly listeners = new Set<(state: ChatState) => void>();

  constructor(showContact: boolean) {
    this.state = {
      phase: 'bootstrapping',
      messages: [],
      liveMessages: {},
      lastEventSequence: 0,
      recentEventIds: [],
      ...(showContact
        ? {
            contactRequest: {
              requestId: 'browser-contact',
              inputKind: 'email' as const,
              purpose: 'handoff_email_delivery' as const,
              prompt: 'Where can our team reach you?',
              required: false,
            },
          }
        : {}),
    };
  }

  getState = () => this.state;

  subscribe = (listener: (state: ChatState) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    this.update({ phase: 'ready' });
  }

  async createConversation(): Promise<Conversation> {
    this.update({ conversation });
    return conversation;
  }

  async selectConversation(): Promise<void> {}

  async sendMessage(request: SubmitMessageRequest): Promise<Message> {
    const text = request.parts.map((part) => part.text).join('');
    const userMessage: Message = {
      messageId: 'browser-user-message',
      conversationId: conversation.conversationId,
      sequence: 1,
      participantId: 'browser-user',
      role: 'user',
      status: 'completed',
      parts: [{ type: 'text', text }],
      createdAt: now,
      completedAt: now,
    };
    this.update({
      phase: 'streaming',
      conversation,
      messages: [userMessage],
      run: { runId: 'browser-run', status: 'running' },
      liveMessages: {
        'browser-assistant-message': {
          messageId: 'browser-assistant-message',
          status: 'streaming',
          text: 'A clear',
          parts: [
            {
              type: 'tool_status',
              toolCallId: 'browser-tool',
              label: 'Checking the mock knowledge base',
              status: 'completed',
            },
          ],
        },
      },
    });
    setTimeout(() => this.completeResponse(userMessage), 80);
    return userMessage;
  }

  async cancel() {
    this.update({
      phase: 'ready',
      liveMessages: {},
      run: { runId: 'browser-run', status: 'cancelled' },
    });
    return {
      conversationId: conversation.conversationId,
      runId: 'browser-run',
      cancellationStatus: 'cancelled' as const,
    };
  }

  async retryRun(): Promise<void> {
    this.update({ phase: 'streaming', run: { runId: 'browser-run-retry', status: 'running' } });
  }

  async retry(): Promise<void> {
    this.update({ phase: 'ready' });
  }

  destroy(): void {
    this.listeners.clear();
  }

  submitStructuredInput = async (requestId: string): Promise<StructuredInputRequest> => {
    const next = { ...this.state };
    delete next.contactRequest;
    this.state = {
      ...next,
      handoff: { handoffId: 'browser-handoff', status: 'requested' },
    };
    this.emit();
    return {
      requestId,
      conversationId: conversation.conversationId,
      runId: 'browser-run',
      inputKind: 'email',
      purpose: 'handoff_email_delivery',
      prompt: 'Where can our team reach you?',
      required: false,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };
  };

  private completeResponse(userMessage: Message): void {
    const assistant: Message = {
      messageId: 'browser-assistant-message',
      conversationId: conversation.conversationId,
      sequence: 2,
      participantId: 'browser-agent',
      role: 'assistant',
      status: 'completed',
      parts: [
        { type: 'text', text: 'A clear deterministic response from the mock agent.' },
        {
          type: 'citation',
          citationId: 'browser-citation',
          sourceId: 'browser-source',
          title: 'Mock source',
          url: 'https://example.com/mock-source',
        },
      ],
      createdAt: now,
      completedAt: now,
    };
    this.update({
      phase: 'ready',
      messages: [userMessage, assistant],
      liveMessages: {},
      run: { runId: 'browser-run', status: 'completed' },
    });
  }

  private update(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

const client = new BrowserFixtureClient(new URL(location.href).searchParams.has('contact'));
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ChatPanel client={client} title="Formation assistant" />
  </StrictMode>,
);

declare global {
  interface Window {
    runAccessibilityAudit(): Promise<axe.AxeResults>;
  }
}

window.runAccessibilityAudit = () => axe.run(document.querySelector('.fcc-chat') as HTMLElement);
