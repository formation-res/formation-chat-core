import { startTransition, useCallback, useMemo, useState } from 'react';
import type { AdminOverview, AdminSiteOverview } from '@formation-chat-core/protocol';

import type { AdminApi } from './admin-client.js';
import { ConversationView } from './conversations.js';
import { DashboardHome } from './home.js';
import { Icon, type IconName } from './icons.js';
import { OperationsList, type OperationsView } from './operations.js';
import { useResource } from './use-resource.js';

type View = 'home' | 'conversations' | OperationsView;

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
  const [view, setView] = useState<View>('home');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [requestedRunId, setRequestedRunId] = useState<string>();
  const [requestedConversationId, setRequestedConversationId] = useState<string>();
  const [selectedSiteId, setSelectedSiteId] = useState<string>();
  const overviewLoader = useCallback((signal: AbortSignal) => api.getOverview(signal), [api]);
  const overview = useResource<AdminOverview>(overviewLoader, `overview:${refreshVersion}`);
  const selectedSite = useMemo(
    () => overview.data?.sites.find((site) => site.siteId === selectedSiteId),
    [overview.data, selectedSiteId],
  );

  const selectSite = (siteId: string, next: View = 'conversations') =>
    startTransition(() => {
      setSelectedSiteId(siteId);
      setRequestedConversationId(undefined);
      setRequestedRunId(undefined);
      setView(next);
    });
  const clearSite = () =>
    startTransition(() => {
      setSelectedSiteId(undefined);
      setRequestedConversationId(undefined);
      setRequestedRunId(undefined);
      setView('home');
    });
  const navigate = (next: View) => {
    if (next === 'home') {
      clearSite();
      return;
    }
    startTransition(() => setView(next));
  };
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
          <NavItems view={view} navigate={navigate} disabled={!selectedSiteId} />
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
            {selectedSite ? <span className="topbar-site">{siteLabel(selectedSite)}</span> : null}
          </div>
          <div className="topbar-actions">
            <label className="domain-selector">
              <span className="sr-only">Select dashboard domain</span>
              <select
                value={selectedSiteId ?? ''}
                onChange={(event) =>
                  event.target.value
                    ? selectSite(event.target.value, view === 'home' ? 'conversations' : view)
                    : clearSite()
                }
              >
                <option value="">Tenant home</option>
                {(overview.data?.sites ?? []).map((site) => (
                  <option key={site.siteId} value={site.siteId}>
                    {siteLabel(site)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
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
          {view === 'home' || !selectedSiteId ? (
            <DashboardHome
              overview={overview.data}
              loading={overview.loading}
              error={overview.error}
              retry={overview.reload}
              onSelectSite={selectSite}
            />
          ) : view === 'conversations' ? (
            <ConversationView
              api={api}
              selectedSiteId={selectedSiteId}
              refreshVersion={refreshVersion}
              requestedConversationId={requestedConversationId}
              onOpenRun={openRun}
            />
          ) : (
            <OperationsList
              api={api}
              view={view}
              selectedSiteId={selectedSiteId}
              refreshVersion={refreshVersion}
              requestedRunId={requestedRunId}
              onOpenConversation={openConversation}
              onOpenRun={openRun}
            />
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile operations views">
        <NavItems view={view} navigate={navigate} disabled={!selectedSiteId} />
      </nav>
    </div>
  );
}

function NavItems({
  view,
  navigate,
  disabled,
}: {
  view: View;
  navigate(next: View): void;
  disabled: boolean;
}) {
  return (
    <>
      {navItems.map((item) => (
        <button
          className={view === item.id ? 'active' : ''}
          key={item.id}
          aria-current={view === item.id ? 'page' : undefined}
          disabled={disabled && item.id !== 'home'}
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
  { id: 'home', label: 'Home', icon: 'activity' },
  { id: 'conversations', label: 'Conversations', icon: 'conversation' },
  { id: 'runs', label: 'Runs', icon: 'runs' },
  { id: 'failures', label: 'Failures', icon: 'alert' },
  { id: 'handoffs', label: 'Handoffs', icon: 'handoff' },
];

const labels: Record<View, string> = {
  home: 'Tenant home',
  conversations: 'Conversation inspector',
  runs: 'Agent runs',
  failures: 'Connector failures',
  handoffs: 'Human handoffs',
};

function siteLabel(site: AdminSiteOverview): string {
  return site.allowedOrigins[0]?.replace(/^https:\/\//, '') ?? site.displayName;
}
