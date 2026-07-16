import { startTransition, useState } from 'react';

import type { AdminApi } from './admin-client.js';
import { ConversationView } from './conversations.js';
import { Icon, type IconName } from './icons.js';
import { OperationsList, type OperationsView } from './operations.js';

type View = 'conversations' | OperationsView;

export function Dashboard({
  api,
  theme,
  onToggleTheme,
  onDisconnect,
}: {
  api: AdminApi;
  theme: 'light' | 'dark';
  onToggleTheme(): void;
  onDisconnect(): void;
}) {
  const [view, setView] = useState<View>('conversations');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [requestedRunId, setRequestedRunId] = useState<string>();
  const [requestedConversationId, setRequestedConversationId] = useState<string>();

  const navigate = (next: View) => startTransition(() => setView(next));
  const openRun = (runId: string) =>
    startTransition(() => {
      setRequestedRunId(runId);
      setView('runs');
    });
  const openConversation = (conversationId: string) =>
    startTransition(() => {
      setRequestedConversationId(conversationId);
      setView('conversations');
    });

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="activity" />
          </span>
          <span>
            <strong>Chat Core</strong>
            <small>Operations</small>
          </span>
        </div>
        <nav aria-label="Primary operations views">
          <NavItems view={view} navigate={navigate} />
        </nav>
        <div className="sidebar-footer">
          <span className="connection-state">
            <span className="health-dot" />
            Admin API connected
          </span>
          <button className="text-button" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="topbar-product">Operations</span>
            <span className="topbar-divider" />
            <span className="topbar-view">{labels[view]}</span>
          </div>
          <div className="topbar-actions">
            <button
              className={`icon-button ${refreshVersion ? '' : ''}`}
              aria-label="Refresh current view"
              onClick={() => setRefreshVersion((value) => value + 1)}
              title="Refresh"
            >
              <Icon name="refresh" />
            </button>
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              onClick={onToggleTheme}
              title="Toggle theme"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </header>
        <main>
          {view === 'conversations' ? (
            <ConversationView
              api={api}
              refreshVersion={refreshVersion}
              requestedConversationId={requestedConversationId}
              onOpenRun={openRun}
            />
          ) : (
            <OperationsList
              api={api}
              view={view}
              refreshVersion={refreshVersion}
              requestedRunId={requestedRunId}
              onOpenConversation={openConversation}
            />
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile operations views">
        <NavItems view={view} navigate={navigate} />
      </nav>
    </div>
  );
}

function NavItems({ view, navigate }: { view: View; navigate(next: View): void }) {
  return (
    <>
      {navItems.map((item) => (
        <button
          className={view === item.id ? 'active' : ''}
          key={item.id}
          aria-current={view === item.id ? 'page' : undefined}
          onClick={() => navigate(item.id)}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {item.id === 'failures' ? (
            <span className="nav-attention" aria-label="Review failures" />
          ) : null}
        </button>
      ))}
    </>
  );
}

const navItems: { id: View; label: string; icon: IconName }[] = [
  { id: 'conversations', label: 'Conversations', icon: 'conversation' },
  { id: 'runs', label: 'Runs', icon: 'runs' },
  { id: 'failures', label: 'Failures', icon: 'alert' },
  { id: 'handoffs', label: 'Handoffs', icon: 'handoff' },
];

const labels: Record<View, string> = {
  conversations: 'Conversation inspector',
  runs: 'Agent runs',
  failures: 'Connector failures',
  handoffs: 'Human handoffs',
};
