import { Composer } from './composer.js';
import { ChatStatus } from './status.js';
import { StructuredInput } from './structured-input.js';
import { Transcript } from './transcript.js';
import type { ChatPanelLabels, ChatPanelProps } from './types.js';
import { useChatClient } from './use-chat-client.js';

const defaultLabels: ChatPanelLabels = {
  title: 'Chat',
  emptyTitle: 'Start a conversation',
  emptyDescription: 'Send a message and the response will appear here.',
  composerLabel: 'Message',
  composerPlaceholder: 'Write a message…',
  send: 'Send',
  retry: 'Retry',
  cancel: 'Stop response',
};

export function ChatPanel(props: ChatPanelProps) {
  const state = useChatClient(props.client);
  const labels = {
    ...defaultLabels,
    ...props.labels,
    ...(props.title ? { title: props.title } : {}),
  };
  const className = ['fcc-chat', props.className].filter(Boolean).join(' ');
  const isLoading = state.phase === 'idle' || state.phase === 'bootstrapping';

  return (
    <section className={className} aria-label={labels.title}>
      <header className="fcc-header">
        <h2>{labels.title}</h2>
        <ChatStatus
          client={props.client}
          state={state}
          retryLabel={labels.retry}
          cancelLabel={labels.cancel}
        />
      </header>
      <div className="fcc-transcript" aria-busy={isLoading}>
        {!isLoading ? (
          <Transcript
            state={state}
            renderMessage={props.renderMessage}
            renderPart={props.renderPart}
            emptyTitle={labels.emptyTitle}
            emptyDescription={labels.emptyDescription}
          />
        ) : null}
      </div>
      <StructuredInput
        {...(state.contactRequest ? { request: state.contactRequest } : {})}
        {...(state.handoff ? { handoff: state.handoff } : {})}
        {...(props.onSubmitStructuredInput ? { onSubmit: props.onSubmitStructuredInput } : {})}
      />
      <Composer
        client={props.client}
        state={state}
        label={labels.composerLabel}
        placeholder={labels.composerPlaceholder}
        sendLabel={labels.send}
      />
    </section>
  );
}
