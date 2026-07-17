import type { AdminOverview, AdminSiteOverview } from '@formation-chat-core/protocol';

import { Icon } from './icons.js';
import { EmptyState, ErrorState, SkeletonList, relativeTime } from './ui.js';

export function DashboardHome({
  overview,
  loading,
  error,
  retry,
  onSelectSite,
}: {
  overview: AdminOverview | undefined;
  loading: boolean;
  error: string | undefined;
  retry(): void;
  onSelectSite(siteId: string): void;
}) {
  if (loading) return <SkeletonList rows={5} />;
  if (error) return <ErrorState message={error} retry={retry} />;
  if (!overview) {
    return (
      <EmptyState
        icon="activity"
        title="No tenant overview"
        detail="Refresh the dashboard to load authorized domains."
      />
    );
  }

  return (
    <section className="home-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tenant overview</p>
          <h1>{overview.tenant.displayName}</h1>
          <p>Select a domain to inspect its conversations, runs, failures, and handoffs.</p>
        </div>
      </div>
      <div className="stats-grid" aria-label="Tenant totals">
        <Stat label="Conversations" value={overview.totals.conversations} />
        <Stat label="Active" value={overview.totals.activeConversations} />
        <Stat label="Runs" value={overview.totals.runs} />
        <Stat label="Failures" value={overview.totals.failures} attention />
        <Stat label="Handoffs" value={overview.totals.handoffs} />
      </div>
      {overview.sites.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No authorized domains"
          detail="This admin token does not include any site scopes."
        />
      ) : (
        <div className="tenant-card-grid">
          {overview.sites.map((site) => (
            <SiteCard key={site.siteId} site={site} onSelect={() => onSelectSite(site.siteId)} />
          ))}
        </div>
      )}
    </section>
  );
}

function SiteCard({ site, onSelect }: { site: AdminSiteOverview; onSelect(): void }) {
  return (
    <button className="tenant-card" onClick={onSelect}>
      <span className="tenant-card-icon">
        <Icon name="activity" />
      </span>
      <span className="tenant-card-main">
        <strong>{site.displayName}</strong>
        <span>{site.allowedOrigins[0] ?? site.siteId}</span>
      </span>
      <span className="tenant-card-stats">
        <Stat label="Conversations" value={site.stats.conversations} compact />
        <Stat label="Runs" value={site.stats.runs} compact />
        <Stat label="Failures" value={site.stats.failures} compact attention />
        <Stat label="Handoffs" value={site.stats.handoffs} compact />
      </span>
      <span className="tenant-card-footer">
        <span>{site.agentRef}</span>
        {site.recentActivityAt ? (
          <time dateTime={site.recentActivityAt}>{relativeTime(site.recentActivityAt)}</time>
        ) : (
          <span>No recent activity</span>
        )}
      </span>
    </button>
  );
}

function Stat({
  label,
  value,
  compact,
  attention,
}: {
  label: string;
  value: number;
  compact?: boolean;
  attention?: boolean;
}) {
  return (
    <span className={`stat ${compact ? 'stat-compact' : ''} ${attention ? 'stat-attention' : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}
