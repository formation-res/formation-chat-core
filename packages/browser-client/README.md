# Browser client

`@formation-chat-core/browser-client` owns browser-side chat protocol state without rendering UI.
It has no dependency on a UI framework, model vendor, or agent runtime.

## Usage

```ts
import { createChatClient, createHttpChatTransport } from '@formation-chat-core/browser-client';

const client = createChatClient({
  siteKey: 'public-site-key',
  transport: createHttpChatTransport({ baseUrl: location.origin }),
});

const unsubscribe = client.subscribe((state) => {
  // Render state.messages and state.liveMessages with your UI framework.
});

await client.start();
if (!client.getState().conversation) await client.createConversation();
await client.sendMessage({ parts: [{ type: 'text', text: 'Hello' }] });

// When state.contactRequest is present, submit or decline the typed request:
const contactRequest = client.getState().contactRequest;
if (contactRequest) {
  await client.submitStructuredInput(contactRequest.requestId, {
    value: 'visitor@example.com',
    consent: true,
  });
}

// On teardown:
unsubscribe();
client.destroy();
```

`start()` bootstraps or resumes the anonymous principal, restores the selected conversation, loads
its canonical messages, and opens the event stream. Writes receive fresh idempotency keys. The
HTTP transport uses `fetch()` rather than `EventSource` because the SSE request requires the
session bearer header.

## State and recovery

The client exposes immutable typed state plus framework-neutral actions. Canonical messages are
ordered by their server sequence. `liveMessages` contains transient deltas and public tool or
citation progress until the corresponding canonical message snapshot is available.

The event cursor is persisted after each validated public event. A `sync.required` event clears the
expired cursor and transient state, fetches the conversation and all message pages, then reconnects
without the expired cursor. Closed or failed streams reconnect with bounded exponential backoff.
`retry()` refreshes the browser session and transport; `retryRun()` calls the protocol's run retry
command. The latter requires a server deployment that implements the proposed retry endpoint.

The default browser storage adapter uses `localStorage` and browser `storage` events. This makes
tabs sharing an origin converge by reloading canonical state when another tab advances the cursor
or changes the selected conversation. Applications can inject `ChatStorage`, `fetch`, ID, timer,
and reconnect-delay adapters for gateways, tests, or nonstandard runtimes.

## Credential handling

The short-lived bearer token exists only inside the HTTP transport instance. It is never included
in public client state or persisted storage. Persisted data is restricted to:

- the opaque anonymous browser identity;
- the selected conversation ID;
- the last public event ID and sequence.

Submitted contact values are sent directly to the scoped structured-input endpoint. They are not
copied into client state or persisted browser storage.

Treat the browser identity as a credential: do not log it, place it in URLs, or copy it between
origins. Production public sites should use the same-origin gateway described in the project brief.

## Verification

```bash
npm test --workspace @formation-chat-core/browser-client
npm run typecheck --workspace @formation-chat-core/browser-client
npm run lint --workspace @formation-chat-core/browser-client
npm run build --workspace @formation-chat-core/browser-client

# Requires a migrated disposable PostgreSQL database and local Google Chrome:
DATABASE_URL=postgresql://... npm run test:browser --workspace @formation-chat-core/browser-client
```

The browser smoke test runs two real Chrome tabs against the reference server and deterministic mock
connector. It verifies streaming, canonical multi-tab ordering, refresh resume, and that no bearer
token reaches `localStorage`.
