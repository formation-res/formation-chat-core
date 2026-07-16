// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app.js';
import type { AdminApi } from '../src/admin-client.js';
import {
  conversation,
  conversationPage,
  eventPage,
  handoffPage,
  messagePage,
  runPage,
} from './fixtures.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  window.localStorage.clear();
});

describe('operations dashboard', () => {
  it('requires an in-memory admin credential before querying the API', async () => {
    const createClient = vi.fn(() => fakeApi());
    render(<App createClient={createClient} />);

    expect(container?.textContent).toContain('Connect to Chat Core');
    expect(createClient).not.toHaveBeenCalled();
    const token = container?.querySelector<HTMLInputElement>('input[name="token"]');
    if (!token) throw new Error('Missing token input.');
    await act(async () => {
      setInput(token, 'test-admin-token');
      container
        ?.querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle();
    });

    expect(createClient).toHaveBeenCalledWith('http://localhost:8080', 'test-admin-token');
    expect(container?.textContent).toContain('Operations');
    expect(container?.textContent).toContain('Support agent conversation');
    expect(container?.querySelector('input[name="token"]')).toBeNull();
  });

  it('shows a detailed transcript and visibility-aware event timeline', async () => {
    render(<App initialClient={fakeApi()} />);
    await act(settle);
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-conversation-id="conversation-1"]')
        ?.click();
      await settle();
    });

    expect(container?.textContent).toContain('How can I change my plan?');
    expect(container?.textContent).toContain('Public transcript');
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')?.click();
      await settle();
    });
    expect(container?.textContent).toContain('Internal diagnostic');
    expect(container?.querySelector('[data-visibility="internal"]')).not.toBeNull();
  });

  it('renders loading, empty, and accessible responsive navigation states', async () => {
    const pending =
      deferred<ReturnType<AdminApi['listConversations']> extends Promise<infer T> ? T : never>();
    const api = fakeApi();
    api.listConversations = vi.fn(() => pending.promise);
    render(<App initialClient={api} />);

    expect(container?.querySelector('[aria-busy="true"]')).not.toBeNull();
    pending.resolve({ data: [], pagination: { hasMore: false } });
    await act(settle);
    expect(container?.textContent).toContain('No conversations match');

    const result = await axe.run(container as HTMLDivElement, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map(({ id }) => id)).toEqual([]);
  });

  it('navigates from a handoff correlation to its agent run', async () => {
    render(<App initialClient={fakeApi()} />);
    await act(async () => {
      [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        .find((button) => button.textContent === 'Handoffs')
        ?.click();
      await settle();
    });
    await act(async () => {
      container
        ?.querySelector('summary')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      container?.querySelector<HTMLButtonElement>('.id-link')?.click();
      await settle();
    });
    expect(container?.textContent).toContain('Agent runs');
  });
});

function render(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeApi(): AdminApi {
  return {
    listConversations: vi.fn(async () => conversationPage),
    getConversation: vi.fn(async () => conversation),
    listMessages: vi.fn(async () => messagePage),
    listEvents: vi.fn(async () => eventPage),
    listRuns: vi.fn(async () => runPage),
    listFailures: vi.fn(async () => ({ data: [], pagination: { hasMore: false as const } })),
    listHandoffs: vi.fn(async () => handoffPage),
  };
}
