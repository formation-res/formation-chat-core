# React reference UI

`@formation-chat-core/ui-react` is the accessible reference interface for the framework-neutral
browser client. It renders public protocol data only; connector and agent implementation details
do not enter its props.

## Use

```tsx
import { ChatPanel } from '@formation-chat-core/ui-react';
import '@formation-chat-core/ui-react/styles.css';

export function SupportChat({ client }: { client: ChatClient }) {
  return <ChatPanel client={client} />;
}
```

The panel starts the supplied client when mounted. The host remains responsible for constructing
the client, providing its transport and storage adapters, and destroying it when appropriate.

When the protocol requests an email address, submit it through the host application's endpoint:

```tsx
<ChatPanel
  client={client}
  onSubmitStructuredInput={async (submission) => {
    await submitContactInput(submission);
  }}
/>
```

The callback receives a protocol-neutral `StructuredInputSubmission`; the UI does not retain or
log the submitted address. Contact delivery is deliberately outside this package.

## Customize

- `renderMessage` replaces an entire message. Call `renderDefault()` to wrap or augment the
  reference renderer.
- `renderPart` replaces individual protocol content parts. Return `undefined` to use the default.
- `labels` overrides visible and accessible copy.
- `className` and low-specificity CSS allow host styles to override the reference presentation.
- CSS custom properties such as `--fcc-color-accent`, `--fcc-color-surface`, `--fcc-color-text`,
  `--fcc-radius`, and `--fcc-font` provide common theme controls.

Importing `styles.css` is optional. The semantic markup and render hooks do not depend on it.

## Accessibility and states

The reference UI uses native forms, explicit labels, keyboard submission, polite transcript and
status announcements, visible focus treatment, and reduced-motion support. It renders loading,
empty, streaming, completed, failed, retry, reconnecting, contact request, and handoff states from
the browser client's public state.

Component tests include automated axe checks. The browser smoke test exercises keyboard input,
the deterministic conversation flow, axe in Chrome, contact-to-handoff behavior, and wide and
narrow screenshots:

```sh
npm run test:browser --workspace @formation-chat-core/ui-react
```

The first implementation is React-only. A Web Component wrapper was intentionally deferred until
a concrete reuse need justifies another public package.
