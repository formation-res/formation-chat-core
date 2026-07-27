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
  overview,
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
  it('requires an SSO session before querying the API', async () => {
    const createClient = vi.fn(() => fakeApi());
    const auth = {
      getSession: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
    };
    render(<App createClient={createClient} auth={auth} />);
    await act(settle);

    expect(container?.textContent).toContain('Sign in to Chat Core');
    expect(createClient).not.toHaveBeenCalled();
    expect(container?.querySelector<HTMLAnchorElement>('a[href="/auth/login"]')).not.toBeNull();
  });

  it('shows a detailed transcript and visibility-aware event timeline', async () => {
    const api = fakeApi();
    render(<App initialClient={api} initialSession={session} />);
    await selectMainWebsite();
    await act(settle);
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-conversation-id="conversation-1"]')
        ?.click();
      await settle();
    });

    expect(container?.textContent).toContain('How can I change my plan?');
    expect(api.listConversations).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-1' }),
      expect.any(AbortSignal),
    );
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
    render(<App initialClient={api} initialSession={session} />);
    await selectMainWebsite();

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
    render(<App initialClient={fakeApi()} initialSession={session} />);
    await selectMainWebsite();
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

  it('clears the selected domain when returning home', async () => {
    render(<App initialClient={fakeApi()} initialSession={session} />);
    await selectMainWebsite();
    expect(container?.querySelector<HTMLSelectElement>('.domain-selector select')?.value).toBe(
      'site-1',
    );

    await act(async () => {
      [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        .find((button) => button.textContent === 'Home')
        ?.click();
      await settle();
    });

    expect(container?.querySelector<HTMLSelectElement>('.domain-selector select')?.value).toBe('');
    expect(container?.textContent).toContain('Tenant overview');
  });
});

function render(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function selectMainWebsite(): Promise<void> {
  await waitForText('Main website');
  const button = [
    ...(container?.querySelectorAll<HTMLButtonElement>('.tenant-card-open') ?? []),
  ].find((candidate) => candidate.textContent?.includes('Main website'));
  if (!button) throw new Error('Main website card was not rendered.');
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    await settle();
  });
}

async function waitForText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await act(settle);
    if (container?.textContent?.includes(text)) return;
  }
  throw new Error(`Timed out waiting for ${text}. Rendered: ${container?.textContent ?? ''}`);
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
    getOverview: vi.fn(async () => overview),
    listConversations: vi.fn(async () => conversationPage),
    getConversation: vi.fn(async () => conversation),
    listMessages: vi.fn(async () => messagePage),
    listEvents: vi.fn(async () => eventPage),
    listRuns: vi.fn(async () => runPage),
    listFailures: vi.fn(async () => ({ data: [], pagination: { hasMore: false as const } })),
    listHandoffs: vi.fn(async () => handoffPage),
  };
}

const session = {
  authenticated: true as const,
  email: 'jo@tryformation.com',
  displayName: 'Jo Formation',
};
