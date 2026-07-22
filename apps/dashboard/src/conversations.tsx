import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Conversation,
  Message,
  ConversationEvent,
  CursorPage,
} from '@formation-chat-core/protocol';

import type { AdminApi } from './admin-client.js';
import { Icon } from './icons.js';
import {
  CorrelationId,
  EmptyState,
  ErrorState,
  SkeletonList,
  StatusBadge,
  VisibilityBadge,
  formatTime,
  humanize,
  relativeTime,
} from './ui.js';
import { useResource } from './use-resource.js';

interface ConversationViewProps {
  api: AdminApi;
  selectedSiteId: string;
  refreshVersion: number;
  requestedConversationId: string | undefined;
  onOpenRun(runId: string): void;
}

export function ConversationView({
  api,
  selectedSiteId,
  refreshVersion,
  requestedConversationId,
  onOpenRun,
}: ConversationViewProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (requestedConversationId) setSelectedId(requestedConversationId);
  }, [requestedConversationId]);
  useEffect(() => {
    setSelectedId(undefined);
  }, [selectedSiteId]);
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.listConversations(
        {
          limit: 100,
          siteId: selectedSiteId,
          ...(status ? { status: status as 'active' | 'completed' | 'cancelled' } : {}),
        },
        signal,
      ),
    [api, selectedSiteId, status],
  );
  const conversations = useResource(
    loader,
    `conversations:${selectedSiteId}:${status}:${refreshVersion}`,
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations.data?.data ?? [];
    return (conversations.data?.data ?? []).filter((conversation) =>
      [
        titleOf(conversation),
        conversation.conversationId,
        conversation.agentRef,
        conversation.siteId,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [conversations.data, search]);

  const select = (conversationId: string) => startTransition(() => setSelectedId(conversationId));

  return (
    <div className={`conversation-workspace ${selectedId ? 'has-selection' : ''}`}>
      <section className="record-pane" aria-label="Conversations">
        <div className="pane-heading">
          <div>
            <p className="eyebrow">Canonical store</p>
            <h1>Conversations</h1>
          </div>
          <span className="record-count">{conversations.data?.data.length ?? '-'}</span>
        </div>
        <div className="filter-row">
          <label className="search-field">
            <span className="sr-only">Search conversations</span>
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search conversations"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="select-field">
            <span className="sr-only">Conversation status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All states</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        {conversations.loading ? (
          <SkeletonList />
        ) : conversations.error ? (
          <ErrorState message={conversations.error} retry={conversations.reload} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="conversation"
            title="No conversations match"
            detail="Try a different search or status filter."
          />
        ) : (
          <ul className="record-list">
            {visible.map((conversation) => (
              <li key={conversation.conversationId}>
                <button
                  className={`record-row ${selectedId === conversation.conversationId ? 'selected' : ''}`}
                  data-conversation-id={conversation.conversationId}
                  onClick={() => select(conversation.conversationId)}
                >
                  <span className="record-row-main">
                    <strong>{titleOf(conversation)}</strong>
                    <span>
                      {conversation.agentRef} · {conversation.siteId}
                    </span>
                  </span>
                  <span className="record-row-meta">
                    <StatusBadge status={conversation.status} />
                    <time dateTime={conversation.updatedAt}>
                      {relativeTime(conversation.updatedAt)}
                    </time>
                  </span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="detail-pane" aria-label="Conversation detail">
        {selectedId ? (
          <ConversationDetail
            api={api}
            conversationId={selectedId}
            onBack={() => setSelectedId(undefined)}
            onOpenRun={onOpenRun}
            refreshVersion={refreshVersion}
          />
        ) : (
          <EmptyState
            icon="conversation"
            title="Select a conversation"
            detail="Inspect its public transcript, ordered events, and correlations."
          />
        )}
      </section>
    </div>
  );
}

function ConversationDetail({
  api,
  conversationId,
  onBack,
  onOpenRun,
  refreshVersion,
}: {
  api: AdminApi;
  conversationId: string;
  onBack(): void;
  onOpenRun(runId: string): void;
  refreshVersion: number;
}) {
  const [tab, setTab] = useState<'transcript' | 'events'>('transcript');
  const [additionalMessages, setAdditionalMessages] = useState<Message[]>([]);
  const [additionalEvents, setAdditionalEvents] = useState<ConversationEvent[]>([]);
  const [messageContinuation, setMessageContinuation] = useState<CursorPage>();
  const [eventContinuation, setEventContinuation] = useState<CursorPage>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [continuationError, setContinuationError] = useState('');
  const conversationLoader = useCallback(
    (signal: AbortSignal) => api.getConversation(conversationId, signal),
    [api, conversationId],
  );
  const messageLoader = useCallback(
    (signal: AbortSignal) => api.listMessages(conversationId, undefined, signal),
    [api, conversationId],
  );
  const eventLoader = useCallback(
    (signal: AbortSignal) => api.listEvents(conversationId, undefined, signal),
    [api, conversationId],
  );
  const conversation = useResource(
    conversationLoader,
    `conversation:${conversationId}:${refreshVersion}`,
  );
  const messages = useResource(messageLoader, `messages:${conversationId}:${refreshVersion}`);
  const events = useResource(eventLoader, `events:${conversationId}:${refreshVersion}`);
  useEffect(() => {
    setAdditionalMessages([]);
    setAdditionalEvents([]);
    setMessageContinuation(undefined);
    setEventContinuation(undefined);
    setContinuationError('');
  }, [conversationId, refreshVersion]);

  const messagePagination = messageContinuation ?? messages.data?.pagination;
  const eventPagination = eventContinuation ?? events.data?.pagination;
  const loadMore = async () => {
    const pagination = tab === 'transcript' ? messagePagination : eventPagination;
    if (!pagination?.hasMore || loadingMore) return;
    setLoadingMore(true);
    setContinuationError('');
    try {
      if (tab === 'transcript') {
        const page = await api.listMessages(conversationId, pagination.nextCursor);
        setAdditionalMessages((current) => [...current, ...page.data]);
        setMessageContinuation(page.pagination);
      } else {
        const page = await api.listEvents(conversationId, pagination.nextCursor);
        setAdditionalEvents((current) => [...current, ...(page.data as ConversationEvent[])]);
        setEventContinuation(page.pagination);
      }
    } catch (reason) {
      setContinuationError(
        reason instanceof Error ? reason.message : 'More history could not be loaded.',
      );
    } finally {
      setLoadingMore(false);
    }
  };

  if (conversation.loading) return <SkeletonList rows={4} />;
  if (conversation.error || !conversation.data)
    return (
      <ErrorState
        message={conversation.error ?? 'Conversation not found.'}
        retry={conversation.reload}
      />
    );

  return (
    <div className="detail-content">
      <header className="detail-header">
        <button
          className="icon-button mobile-back"
          aria-label="Back to conversations"
          onClick={onBack}
        >
          <Icon name="arrow-left" />
        </button>
        <div>
          <p className="eyebrow">
            {conversation.data.siteId} · {conversation.data.agentRef}
          </p>
          <h2>{titleOf(conversation.data)}</h2>
          <div className="detail-subtitle">
            <StatusBadge status={conversation.data.status} />
            <span>Updated {formatTime(conversation.data.updatedAt)}</span>
          </div>
        </div>
      </header>
      <div className="correlation-strip" aria-label="Conversation correlations">
        <CorrelationId label="Conversation" value={conversation.data.conversationId} />
        <CorrelationId label="Principal" value={conversation.data.principalId} />
      </div>
      <div className="tabs" role="tablist" aria-label="Conversation inspection">
        <button
          role="tab"
          aria-selected={tab === 'transcript'}
          onClick={() => setTab('transcript')}
        >
          Public transcript <span>{messages.data?.data.length ?? '-'}</span>
        </button>
        <button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>
          Event timeline <span>{events.data?.data.length ?? '-'}</span>
        </button>
      </div>
      {tab === 'transcript' ? (
        <Transcript
          messages={messages.data ? [...messages.data.data, ...additionalMessages] : undefined}
          loading={messages.loading}
          error={messages.error}
          retry={messages.reload}
        />
      ) : (
        <EventTimeline
          events={
            events.data
              ? [...(events.data.data as ConversationEvent[]), ...additionalEvents]
              : undefined
          }
          loading={events.loading}
          error={events.error}
          retry={events.reload}
          onOpenRun={onOpenRun}
        />
      )}
      {(tab === 'transcript' ? messagePagination?.hasMore : eventPagination?.hasMore) ? (
        <button
          className="button button-secondary load-more"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? <span className="spinner" /> : null}
          {loadingMore ? 'Loading more…' : 'Load more history'}
        </button>
      ) : null}
      {continuationError ? (
        <p className="continuation-error" role="alert">
          {continuationError}
        </p>
      ) : null}
    </div>
  );
}

function Transcript({
  messages,
  loading,
  error,
  retry,
}: {
  messages: Message[] | undefined;
  loading: boolean;
  error: string | undefined;
  retry(): void;
}) {
  if (loading) return <SkeletonList rows={5} />;
  if (error) return <ErrorState message={error} retry={retry} />;
  if (!messages?.length)
    return (
      <EmptyState
        icon="conversation"
        title="No messages yet"
        detail="This conversation has no canonical transcript content."
      />
    );
  return (
    <ol className="transcript" aria-label="Public transcript">
      {messages.map((message) => (
        <li className={`message message-${message.role}`} key={message.messageId}>
          <div className="message-meta">
            <strong>
              {message.role === 'assistant'
                ? 'Agent'
                : message.role === 'user'
                  ? 'Visitor'
                  : 'System'}
            </strong>
            <span>#{message.sequence}</span>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
            <StatusBadge status={message.status} />
          </div>
          <div className="message-body">
            {message.parts.map((part, index) => (
              <ContentPart key={`${message.messageId}-${index}`} part={part} />
            ))}
          </div>
          <CorrelationId label="Message" value={message.messageId} />
        </li>
      ))}
    </ol>
  );
}

function ContentPart({ part }: { part: Message['parts'][number] }) {
  if (part.type === 'text') return <p>{part.text}</p>;
  if (part.type === 'citation')
    return (
      <div className="content-part">
        <strong>{part.title ?? 'Citation'}</strong>
        {part.excerpt ? <p>{part.excerpt}</p> : null}
        {part.url ? (
          <a href={part.url} target="_blank" rel="noreferrer">
            Open source
          </a>
        ) : null}
      </div>
    );
  if (part.type === 'file_reference')
    return (
      <div className="content-part">
        <strong>File · {part.name}</strong>
        <span>{part.mediaType}</span>
      </div>
    );
  if (part.type === 'tool_status')
    return (
      <div className="content-part">
        <span>Tool · {part.label}</span>
        <StatusBadge status={part.status} />
      </div>
    );
  return (
    <div className="content-part">
      <span>Structured input · {part.label}</span>
      <StatusBadge status={part.status} />
    </div>
  );
}

function EventTimeline({
  events,
  loading,
  error,
  retry,
  onOpenRun,
}: {
  events: ConversationEvent[] | undefined;
  loading: boolean;
  error: string | undefined;
  retry(): void;
  onOpenRun(runId: string): void;
}) {
  if (loading) return <SkeletonList rows={6} />;
  if (error) return <ErrorState message={error} retry={retry} />;
  if (!events?.length)
    return (
      <EmptyState
        icon="activity"
        title="No retained events"
        detail="The retained event window is empty for this conversation."
      />
    );
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.eventId} data-visibility={event.visibility}>
          <span className={`timeline-marker marker-${event.visibility}`} />
          <div className="timeline-content">
            <div className="timeline-heading">
              <strong>{humanize(event.type)}</strong>
              <VisibilityBadge visibility={event.visibility} />
              <span>#{event.sequence}</span>
              <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
            </div>
            <div className="correlation-row">
              <CorrelationId label="Event" value={event.eventId} />
              {event.runId ? (
                <CorrelationId
                  label="Run"
                  value={event.runId}
                  onOpen={() => onOpenRun(event.runId as string)}
                />
              ) : null}
              {event.messageId ? <CorrelationId label="Message" value={event.messageId} /> : null}
            </div>
            <EventSummary event={event} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function EventSummary({ event }: { event: ConversationEvent }) {
  if ('label' in event.data && typeof event.data.label === 'string')
    return <p className="event-summary">{event.data.label}</p>;
  if ('code' in event.data && typeof event.data.code === 'string')
    return (
      <p className="event-summary">
        Failure code: <code>{event.data.code}</code>
      </p>
    );
  if ('reason' in event.data && typeof event.data.reason === 'string')
    return <p className="event-summary">{humanize(event.data.reason)}</p>;
  return null;
}

function titleOf(conversation: Conversation): string {
  const title =
    'title' in conversation && typeof conversation.title === 'string'
      ? conversation.title.trim()
      : '';
  if (title) return title;
  const agent = conversation.agentRef.replaceAll(/[-_.]+/g, ' ');
  return `${agent.charAt(0).toUpperCase()}${agent.slice(1)} conversation`;
}
