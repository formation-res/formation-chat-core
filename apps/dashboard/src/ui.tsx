import { useState } from 'react';

import { Icon, type IconName } from './icons.js';

export function StatusBadge({ status }: { status: string }) {
  const tone = ['completed', 'active'].includes(status)
    ? 'positive'
    : ['failed', 'cancelled'].includes(status)
      ? 'danger'
      : ['queued', 'requested', 'awaiting_contact', 'waiting_for_input'].includes(status)
        ? 'warning'
        : 'neutral';
  return <span className={`status-badge status-${tone}`}>{humanize(status)}</span>;
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  const label =
    visibility === 'internal'
      ? 'Internal diagnostic'
      : visibility === 'operator'
        ? 'Operator metadata'
        : 'Public';
  return <span className={`visibility visibility-${visibility}`}>{label}</span>;
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading records">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-line skeleton-line-wide" />
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: IconName;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <Icon name="alert" />
      <div>
        <strong>Couldn’t load this view</strong>
        <p>{message}</p>
      </div>
      <button className="button button-secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

export function CorrelationId({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string;
  onOpen?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <span className="correlation-id">
      <span>
        <small>{label}</small>
        {onOpen ? (
          <button className="id-link" onClick={onOpen}>
            {value}
          </button>
        ) : (
          <code>{value}</code>
        )}
      </span>
      <button
        className="icon-button compact"
        aria-label={`Copy ${label}`}
        onClick={() => void copy()}
        title={`Copy ${label}`}
      >
        <Icon name="copy" />
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied` : ''}
      </span>
    </span>
  );
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' · ');
}
