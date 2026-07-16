import type { ContactRequestState, HandoffState } from '@formation-chat-core/browser-client';
import { useId, useState, type FormEvent } from 'react';

import type { StructuredInputSubmission } from './types.js';

interface StructuredInputProps {
  request?: ContactRequestState;
  handoff?: HandoffState;
  onSubmit?: (submission: StructuredInputSubmission) => Promise<void>;
}

export function StructuredInput({ request, handoff, onSubmit }: StructuredInputProps) {
  return (
    <div className="fcc-followup" aria-live="polite">
      {request ? <EmailInput request={request} onSubmit={onSubmit} /> : null}
      {handoff ? (
        <p className="fcc-handoff" role="status">
          {handoff.status === 'completed'
            ? 'Your conversation has been handed off.'
            : 'Connecting you with our team…'}
        </p>
      ) : null}
    </div>
  );
}

function EmailInput({
  request,
  onSubmit,
}: {
  request: ContactRequestState;
  onSubmit: StructuredInputProps['onSubmit'];
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'submitted' | 'declined'>('idle');
  const [error, setError] = useState<string>();
  const emailId = useId();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!onSubmit || status !== 'idle') return;
    if (!event.currentTarget.checkValidity()) return;
    setStatus('submitting');
    setError(undefined);
    try {
      await onSubmit({
        requestId: request.requestId,
        inputKind: 'email',
        value: email.trim(),
        consent: true,
      });
      setStatus('submitted');
    } catch {
      setStatus('idle');
      setError('Your email could not be shared.');
    }
  }

  async function decline(): Promise<void> {
    if (!onSubmit || status !== 'idle') return;
    setStatus('submitting');
    setError(undefined);
    try {
      await onSubmit({ requestId: request.requestId, inputKind: 'email', declined: true });
      setStatus('declined');
    } catch {
      setStatus('idle');
      setError('The request could not be declined.');
    }
  }

  if (status === 'submitted') return <p role="status">Email shared.</p>;
  if (status === 'declined') return <p role="status">Email request declined.</p>;

  return (
    <form className="fcc-contact" aria-label="Share contact details" onSubmit={submit}>
      <p>{request.prompt}</p>
      <p>Your email will be used to send this conversation to our team and copy you.</p>
      <label htmlFor={emailId}>Email address</label>
      <div className="fcc-contact__controls">
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          value={email}
          disabled={!onSubmit || status === 'submitting'}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <button type="submit" disabled={!onSubmit || status === 'submitting'}>
          Share email
        </button>
        <button type="button" disabled={!onSubmit || status === 'submitting'} onClick={decline}>
          Not now
        </button>
      </div>
      {!onSubmit ? <p role="note">Contact submission is not configured.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
