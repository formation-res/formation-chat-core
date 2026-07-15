import type { ChatState } from '@formation-chat-core/browser-client';
import type { ContentPart } from '@formation-chat-core/protocol';

import { ContentParts } from './content-parts.js';
import type { ChatDisplayMessage, ChatPanelProps } from './types.js';

interface TranscriptProps {
  state: ChatState;
  renderMessage: ChatPanelProps['renderMessage'];
  renderPart: ChatPanelProps['renderPart'];
  emptyTitle: string;
  emptyDescription: string;
}

export function Transcript(props: TranscriptProps) {
  const messages = displayMessages(props.state);
  if (messages.length === 0) {
    return (
      <div className="fcc-empty">
        <h3>{props.emptyTitle}</h3>
        <p>{props.emptyDescription}</p>
      </div>
    );
  }
  return (
    <ol
      className="fcc-messages"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((message) => {
        const renderDefault = () => (
          <DefaultMessage message={message} renderPart={props.renderPart} />
        );
        const rendered = props.renderMessage
          ? props.renderMessage({ message, state: props.state, renderDefault })
          : renderDefault();
        return (
          <li key={message.messageId} className={`fcc-message fcc-message--${message.role}`}>
            {rendered}
          </li>
        );
      })}
    </ol>
  );
}

function DefaultMessage({
  message,
  renderPart,
}: {
  message: ChatDisplayMessage;
  renderPart: ChatPanelProps['renderPart'];
}) {
  return (
    <article className="fcc-bubble" aria-label={roleLabel(message.role)}>
      <span className="fcc-visually-hidden">{roleLabel(message.role)}:</span>
      <ContentParts message={message} renderPart={renderPart} />
      {message.status === 'streaming' ? <span className="fcc-caret" aria-hidden="true" /> : null}
    </article>
  );
}

function roleLabel(role: ChatDisplayMessage['role']): string {
  if (role === 'user') return 'You';
  if (role === 'system') return 'System';
  return 'Assistant';
}

function displayMessages(state: ChatState): ChatDisplayMessage[] {
  const canonical: ChatDisplayMessage[] = state.messages.map((message) => ({
    messageId: message.messageId,
    role: message.role,
    status: message.status,
    parts: message.parts,
    text: textFromParts(message.parts),
    isTransient: false,
  }));
  const live: ChatDisplayMessage[] = Object.values(state.liveMessages).map((message) => ({
    messageId: message.messageId,
    role: 'assistant',
    status: message.status,
    parts: liveParts(message.text, message.parts),
    text: message.text,
    isTransient: true,
  }));
  return [...canonical, ...live];
}

function liveParts(text: string, parts: readonly ContentPart[]): ContentPart[] {
  if (!text || parts.some((part) => part.type === 'text')) return [...parts];
  return [{ type: 'text', text }, ...parts];
}

function textFromParts(parts: readonly ContentPart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
