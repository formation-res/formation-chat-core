// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';

import type { ChatClient, ChatState } from '@formation-chat-core/browser-client';

import { ChatPanel } from '../src/index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('ChatPanel', () => {
  it('renders loading and empty states with an accessible composer', async () => {
    const fake = createFakeClient({ phase: 'bootstrapping' });
    render(<ChatPanel client={fake.client} title="Ask Formation" />);
    expect(container?.querySelector('[role="status"]')?.textContent).toContain('Starting');

    fake.setState({ phase: 'ready' });
    expect(container?.textContent).toContain('Start a conversation');
    expect(container?.querySelector('textarea')?.getAttribute('aria-label')).toBe('Message');
    expect(container?.querySelector('button[type="submit"]')?.textContent).toBe('Send');
  });

  it('creates a conversation and sends trimmed text from the composer', async () => {
    const fake = createFakeClient({ phase: 'ready' });
    render(<ChatPanel client={fake.client} />);
    const textarea = container?.querySelector('textarea');
    if (!textarea) throw new Error('Missing composer.');
    await act(async () => {
      setInputValue(textarea, '  Hello there  ');
      container
        ?.querySelector('form[aria-label="Send a message"]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(fake.client.createConversation).toHaveBeenCalledOnce();
    expect(fake.client.sendMessage).toHaveBeenCalledWith({
      parts: [{ type: 'text', text: 'Hello there' }],
    });
  });

  it('sends with Enter and keeps Shift+Enter available for a new line', async () => {
    const fake = createFakeClient({ phase: 'ready', conversation });
    render(<ChatPanel client={fake.client} />);
    const textarea = container?.querySelector('textarea');
    if (!textarea) throw new Error('Missing composer.');
    await act(async () => {
      setInputValue(textarea, 'Keyboard message');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(fake.client.sendMessage).toHaveBeenCalledOnce();
  });

  it('renders canonical and live messages and supports a replacement renderer', () => {
    const fake = createFakeClient({
      phase: 'streaming',
      messages: [message('user-message', 'user', 'Question')],
      liveMessages: {
        'assistant-message': {
          messageId: 'assistant-message',
          status: 'streaming',
          text: 'Working',
          parts: [],
        },
      },
    });
    render(
      <ChatPanel
        client={fake.client}
        renderMessage={({ message }) => <strong data-custom-message>{message.text}</strong>}
      />,
    );
    expect(container?.querySelectorAll('[data-custom-message]')).toHaveLength(2);
    expect(container?.textContent).toContain('Working');
    expect(container?.querySelector('[role="status"]')?.textContent).toContain('responding');
  });

  it('does not turn an untrusted non-HTTPS content URL into a link', () => {
    const fake = createFakeClient({
      phase: 'ready',
      messages: [
        {
          ...message('assistant-message', 'assistant', 'Answer'),
          parts: [
            {
              type: 'citation',
              citationId: 'citation-1',
              sourceId: 'source-1',
              title: 'Unsafe source',
              url: 'javascript:alert(1)',
            },
          ],
        },
      ],
    });
    render(<ChatPanel client={fake.client} />);
    expect(container?.textContent).toContain('Unsafe source');
    expect(container?.querySelector('a')).toBeNull();
  });

  it('announces reconnecting and failed states and exposes retry', async () => {
    const fake = createFakeClient({
      phase: 'error',
      error: { code: 'MOCK_FAILURE', message: 'The agent run failed.', retryable: true },
      run: { runId: 'run-1', status: 'failed', failureCode: 'MOCK_FAILURE' },
    });
    render(<ChatPanel client={fake.client} />);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('agent run failed');
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('button[data-action="retry"]')?.click(),
    );
    expect(fake.client.retryRun).toHaveBeenCalledOnce();

    fake.setState({ phase: 'reconnecting' });
    expect(container?.querySelector('[role="status"]')?.textContent).toContain('Reconnecting');
  });

  it('submits a validated structured email and announces handoff state', async () => {
    const submitInput = vi.fn(async () => undefined);
    const fake = createFakeClient({
      phase: 'ready',
      contactRequest: {
        requestId: 'request-1',
        inputKind: 'email',
        prompt: 'Where can we reach you?',
        purpose: 'handoff_email_delivery',
        required: false,
      },
      handoff: { handoffId: 'handoff-1', status: 'requested' },
    });
    render(<ChatPanel client={fake.client} onSubmitStructuredInput={submitInput} />);
    const input = container?.querySelector<HTMLInputElement>('input[type="email"]');
    if (!input) throw new Error('Missing email input.');
    await act(async () => {
      setInputValue(input, 'visitor@example.com');
      container
        ?.querySelector('form[aria-label="Share contact details"]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(submitInput).toHaveBeenCalledWith({
      requestId: 'request-1',
      inputKind: 'email',
      value: 'visitor@example.com',
      consent: true,
    });
    expect(container?.textContent).toContain('Connecting you with our team');
  });

  it('uses the browser client structured-input command by default', async () => {
    const fake = createFakeClient({
      phase: 'ready',
      contactRequest: {
        requestId: 'request-default',
        inputKind: 'email',
        purpose: 'handoff_email_delivery',
        prompt: 'Where can we reach you?',
        required: false,
      },
    });
    render(<ChatPanel client={fake.client} />);
    expect(container?.textContent).toContain('send this conversation');
    const input = container?.querySelector<HTMLInputElement>('input[type="email"]');
    if (!input) throw new Error('Missing email input.');
    await act(async () => {
      setInputValue(input, 'visitor@example.com');
      container
        ?.querySelector('form[aria-label="Share contact details"]')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(fake.client.submitStructuredInput).toHaveBeenCalledWith('request-default', {
      value: 'visitor@example.com',
      consent: true,
    });
  });

  it('has no automated accessibility violations in the ready state', async () => {
    const fake = createFakeClient({
      phase: 'ready',
      messages: [message('user-message', 'user', 'Accessible question')],
    });
    render(<ChatPanel client={fake.client} />);
    const result = await axe.run(container as HTMLDivElement, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map(({ id }) => id)).toEqual([]);
  });
});

function render(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

function setInputValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function createFakeClient(overrides: Partial<ChatState>) {
  let state: ChatState = {
    phase: 'idle',
    messages: [],
    liveMessages: {},
    lastEventSequence: 0,
    recentEventIds: [],
    ...overrides,
  };
  const listeners = new Set<(next: ChatState) => void>();
  const client: ChatClient = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => undefined),
    createConversation: vi.fn(async () => conversation),
    selectConversation: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => message('sent-message', 'user', 'sent')),
    submitStructuredInput: vi.fn(async (requestId) => ({
      requestId,
      conversationId: 'conversation-1',
      runId: 'run-1',
      inputKind: 'email' as const,
      purpose: 'handoff_email_delivery' as const,
      prompt: 'Where can we reach you?',
      required: false,
      status: 'submitted' as const,
      createdAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:01:00.000Z',
    })),
    cancel: vi.fn(async () => ({
      conversationId: 'conversation-1',
      runId: 'run-1',
      cancellationStatus: 'cancelled' as const,
    })),
    retryRun: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    destroy: vi.fn(),
  };
  return {
    client,
    setState(next: Partial<ChatState>) {
      act(() => {
        state = { ...state, ...next };
        for (const listener of listeners) listener(state);
      });
    },
  };
}

const conversation = {
  conversationId: 'conversation-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  principalId: 'principal-1',
  agentRef: 'agent-1',
  status: 'active' as const,
  participants: [
    { participantId: 'user-1', kind: 'user' as const, principalId: 'principal-1' },
    { participantId: 'agent-1', kind: 'agent' as const, agentRef: 'agent-1' },
  ],
  createdAt: '2026-07-15T10:00:00.000Z',
  updatedAt: '2026-07-15T10:00:00.000Z',
};

function message(messageId: string, role: 'user' | 'assistant', text: string) {
  return {
    messageId,
    conversationId: 'conversation-1',
    sequence: role === 'user' ? 1 : 2,
    participantId: `${role}-1`,
    role,
    status: 'completed' as const,
    parts: [{ type: 'text' as const, text }],
    createdAt: '2026-07-15T10:00:00.000Z',
    completedAt: '2026-07-15T10:00:00.000Z',
  };
}
