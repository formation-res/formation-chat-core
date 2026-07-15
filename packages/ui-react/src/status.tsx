import type { ChatClient, ChatState } from '@formation-chat-core/browser-client';

export function ChatStatus({
  client,
  state,
  retryLabel,
  cancelLabel,
}: {
  client: ChatClient;
  state: ChatState;
  retryLabel: string;
  cancelLabel: string;
}) {
  const label = statusLabel(state);
  const retry = state.error?.retryable;
  return (
    <div className="fcc-status-area">
      <p className="fcc-status" role="status" aria-live="polite">
        {label}
      </p>
      {state.error ? (
        <div className="fcc-error" role="alert">
          <span>{state.error.message}</span>
          {retry ? (
            <button
              type="button"
              data-action="retry"
              onClick={() =>
                runSafely(state.run?.status === 'failed' ? client.retryRun() : client.retry())
              }
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {state.run?.status === 'running' || state.run?.status === 'queued' ? (
        <button type="button" className="fcc-cancel" onClick={() => runSafely(client.cancel())}>
          {cancelLabel}
        </button>
      ) : null}
    </div>
  );
}

function runSafely(action: Promise<unknown>): void {
  void action.catch(() => undefined);
}

function statusLabel(state: ChatState): string {
  if (state.phase === 'idle' || state.phase === 'bootstrapping') return 'Starting chat…';
  if (state.phase === 'reconnecting') return 'Reconnecting…';
  if (state.run?.status === 'failed') return 'Response failed';
  if (state.phase === 'streaming' || ['queued', 'running'].includes(state.run?.status ?? '')) {
    return 'Assistant is responding…';
  }
  if (state.run?.status === 'completed') return 'Response complete';
  return 'Ready';
}
