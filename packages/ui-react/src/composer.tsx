import type { ChatClient, ChatState } from '@formation-chat-core/browser-client';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';

interface ComposerProps {
  client: ChatClient;
  state: ChatState;
  label: string;
  placeholder: string;
  sendLabel: string;
}

export function Composer({ client, state, label, placeholder, sendLabel }: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const unavailable = state.phase === 'bootstrapping' || state.phase === 'idle';
  const composerId = useId();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text || unavailable || isSubmitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      if (!state.conversation) await client.createConversation();
      await client.sendMessage({ parts: [{ type: 'text', text }] });
      setDraft('');
    } catch {
      setError('The message could not be sent.');
    } finally {
      setSubmitting(false);
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="fcc-composer" aria-label="Send a message" onSubmit={submit}>
      <label className="fcc-visually-hidden" htmlFor={composerId}>
        {label}
      </label>
      <textarea
        id={composerId}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        maxLength={100_000}
        rows={1}
        disabled={unavailable || isSubmitting}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={submitOnEnter}
      />
      <button type="submit" disabled={!draft.trim() || unavailable || isSubmitting}>
        {isSubmitting ? 'Sending…' : sendLabel}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
