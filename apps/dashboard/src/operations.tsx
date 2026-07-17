import { useCallback, useState } from 'react';
import type {
  AdminAgentRun,
  AdminFailure,
  AdminFailureList,
  AdminHandoff,
  AdminHandoffList,
  AdminRunList,
} from '@formation-chat-core/protocol';

import type { AdminApi } from './admin-client.js';
import { Icon, type IconName } from './icons.js';
import {
  CorrelationId,
  EmptyState,
  ErrorState,
  SkeletonList,
  StatusBadge,
  formatTime,
  relativeTime,
} from './ui.js';
import { useResource } from './use-resource.js';

export type OperationsView = 'runs' | 'failures' | 'handoffs';

interface OperationsListProps {
  api: AdminApi;
  view: OperationsView;
  selectedSiteId: string;
  refreshVersion: number;
  requestedRunId: string | undefined;
  onOpenConversation(conversationId: string): void;
  onOpenRun(runId: string): void;
}

export function OperationsList({
  api,
  view,
  selectedSiteId,
  refreshVersion,
  requestedRunId,
  onOpenConversation,
  onOpenRun,
}: OperationsListProps) {
  const [status, setStatus] = useState('');
  const loader = useCallback<(signal: AbortSignal) => Promise<OperationPage>>(
    (signal: AbortSignal) => {
      if (view === 'runs')
        return api.listRuns(
          {
            limit: 100,
            siteId: selectedSiteId,
            ...(status ? { status: status as AdminAgentRun['status'] } : {}),
          },
          signal,
        );
      if (view === 'failures') return api.listFailures({ limit: 100, siteId: selectedSiteId }, signal);
      return api.listHandoffs(
        {
          limit: 100,
          siteId: selectedSiteId,
          ...(status ? { status: status as AdminHandoff['status'] } : {}),
        },
        signal,
      );
    },
    [api, selectedSiteId, status, view],
  );
  const resource = useResource<OperationPage>(
    loader,
    `${view}:${selectedSiteId}:${status}:${refreshVersion}`,
  );
  const config = viewConfig[view];
  const data: unknown[] = resource.data?.data ?? [];

  return (
    <section className="operations-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operational visibility</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <div className="heading-actions">
          <span className="record-count">{resource.data?.data.length ?? '—'}</span>
          {view !== 'failures' ? (
            <label className="select-field">
              <span className="sr-only">Filter by status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All states</option>
                {config.statuses.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <div className="health-strip">
        <span>
          <Icon name={config.icon} />
          <strong>{data.length}</strong> in current window
        </span>
        <span>
          <span className="health-dot" />
          API connected
        </span>
        <span>Read-only view</span>
      </div>
      {resource.loading ? (
        <SkeletonList rows={7} />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : data.length === 0 ? (
        <EmptyState icon={config.icon} title={config.emptyTitle} detail={config.emptyDetail} />
      ) : (
        <div className="expandable-list">
          {view === 'runs'
            ? (data as AdminAgentRun[]).map((item) => (
                <RunRow
                  key={item.runId}
                  item={item}
                  initiallyOpen={item.runId === requestedRunId}
                  onOpenConversation={onOpenConversation}
                />
              ))
            : null}
          {view === 'failures'
            ? (data as AdminFailure[]).map((item) => (
                <FailureRow
                  key={item.runId}
                  item={item}
                  onOpenConversation={onOpenConversation}
                  onOpenRun={onOpenRun}
                />
              ))
            : null}
          {view === 'handoffs'
            ? (data as AdminHandoff[]).map((item) => (
                <HandoffRow
                  key={item.handoffId}
                  item={item}
                  onOpenConversation={onOpenConversation}
                  onOpenRun={onOpenRun}
                />
              ))
            : null}
        </div>
      )}
      {resource.data?.pagination.hasMore ? (
        <p className="history-note">
          Showing the newest 100 records. More are available through cursor pagination.
        </p>
      ) : null}
    </section>
  );
}

function RunRow({
  item,
  initiallyOpen,
  onOpenConversation,
}: {
  item: AdminAgentRun;
  initiallyOpen: boolean;
  onOpenConversation(id: string): void;
}) {
  return (
    <details className="expandable-row" open={initiallyOpen}>
      <summary>
        <span className="summary-icon">
          <Icon name="runs" />
        </span>
        <span className="summary-main">
          <strong>{item.agentRef}</strong>
          <span>{item.runId}</span>
        </span>
        <StatusBadge status={item.status} />
        <span className="summary-time">
          <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
          <small>Attempt {item.attempt}</small>
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="expanded-content">
        <div className="correlation-grid">
          <CorrelationId label="Run" value={item.runId} />
          <CorrelationId
            label="Conversation"
            value={item.conversationId}
            onOpen={() => onOpenConversation(item.conversationId)}
          />
          <CorrelationId label="User message" value={item.userMessageId} />
          <CorrelationId label="Assistant message" value={item.assistantMessageId} />
        </div>
        <dl className="metadata-list">
          <div>
            <dt>Site</dt>
            <dd>{item.siteId}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatTime(item.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTime(item.updatedAt)}</dd>
          </div>
          {item.completedAt ? (
            <div>
              <dt>Completed</dt>
              <dd>{formatTime(item.completedAt)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="diagnostic-note">
          External connector trace IDs are not present in this run’s canonical record. Use the run
          ID for cross-system correlation.
        </p>
      </div>
    </details>
  );
}

function FailureRow({
  item,
  onOpenConversation,
  onOpenRun,
}: {
  item: AdminFailure;
  onOpenConversation(id: string): void;
  onOpenRun(id: string): void;
}) {
  return (
    <details className="expandable-row failure-row">
      <summary>
        <span className="summary-icon">
          <Icon name="alert" />
        </span>
        <span className="summary-main">
          <strong>{item.errorCode}</strong>
          <span>
            {item.agentRef} · {item.runId}
          </span>
        </span>
        <StatusBadge status="failed" />
        <span className="summary-time">
          <time dateTime={item.updatedAt}>{relativeTime(item.updatedAt)}</time>
          <small>Attempt {item.attempt}</small>
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="expanded-content">
        <div className="correlation-grid">
          <CorrelationId label="Run" value={item.runId} onOpen={() => onOpenRun(item.runId)} />
          <CorrelationId
            label="Conversation"
            value={item.conversationId}
            onOpen={() => onOpenConversation(item.conversationId)}
          />
          <CorrelationId label="User message" value={item.userMessageId} />
          <CorrelationId label="Assistant message" value={item.assistantMessageId} />
        </div>
        <p className="diagnostic-note">
          Only the stable failure code is retained here. Provider details remain outside public
          transcript content.
        </p>
      </div>
    </details>
  );
}

function HandoffRow({
  item,
  onOpenConversation,
  onOpenRun,
}: {
  item: AdminHandoff;
  onOpenConversation(id: string): void;
  onOpenRun(id: string): void;
}) {
  return (
    <details className="expandable-row">
      <summary>
        <span className="summary-icon">
          <Icon name="handoff" />
        </span>
        <span className="summary-main">
          <strong>Handoff</strong>
          <span>{item.handoffId}</span>
        </span>
        <StatusBadge status={item.status} />
        <span className="summary-time">
          <time dateTime={item.updatedAt}>{relativeTime(item.updatedAt)}</time>
          <small>{item.siteId}</small>
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="expanded-content">
        <div className="correlation-grid">
          <CorrelationId label="Handoff" value={item.handoffId} />
          <CorrelationId label="Run" value={item.runId} onOpen={() => onOpenRun(item.runId)} />
          <CorrelationId
            label="Conversation"
            value={item.conversationId}
            onOpen={() => onOpenConversation(item.conversationId)}
          />
        </div>
        <dl className="metadata-list">
          <div>
            <dt>Created</dt>
            <dd>{formatTime(item.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTime(item.updatedAt)}</dd>
          </div>
        </dl>
        <p className="diagnostic-note">
          Contact values are intentionally redacted from the admin API.
        </p>
      </div>
    </details>
  );
}

const viewConfig: Record<
  OperationsView,
  {
    title: string;
    description: string;
    icon: IconName;
    emptyTitle: string;
    emptyDetail: string;
    statuses: string[];
  }
> = {
  runs: {
    title: 'Agent runs',
    description: 'Execution state, retry attempts, and cross-system correlations.',
    icon: 'runs',
    emptyTitle: 'No agent runs',
    emptyDetail: 'No runs match this status in the current query window.',
    statuses: [
      'queued',
      'running',
      'waiting_for_input',
      'completed',
      'failed',
      'cancel_requested',
      'cancelled',
    ],
  },
  failures: {
    title: 'Connector failures',
    description: 'Stable failure codes and retry context without provider leakage.',
    icon: 'alert',
    emptyTitle: 'No connector failures',
    emptyDetail: 'There are no failed runs in the current query window.',
    statuses: [],
  },
  handoffs: {
    title: 'Human handoffs',
    description: 'Pending, delivering, completed, and failed email handoffs.',
    icon: 'handoff',
    emptyTitle: 'No human handoffs',
    emptyDetail: 'No handoffs match this status in the current query window.',
    statuses: ['requested', 'awaiting_contact', 'delivering', 'completed', 'failed'],
  },
};

type OperationPage = AdminRunList | AdminFailureList | AdminHandoffList;
