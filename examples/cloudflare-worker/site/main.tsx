import { createChatClient, createHttpChatTransport } from '@formation-chat-core/browser-client';
import { ChatPanel } from '@formation-chat-core/ui-react';
import '@formation-chat-core/ui-react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './site.css';

const widgetQuery = new URLSearchParams();
for (const key of ['widgetKey', 'agent'] as const) {
  const value = new URLSearchParams(location.search).get(key);
  if (value) widgetQuery.set(key, value);
}

const client = createChatClient({
  siteKey: 'same-origin-gateway',
  transport: createHttpChatTransport({
    baseUrl: location.origin,
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/v1/sessions') {
        for (const [key, value] of widgetQuery) url.searchParams.set(key, value);
      }
      return fetch(input instanceof Request ? new Request(url, input) : url, init);
    },
  }),
});
const root = document.getElementById('chat-root');
if (!root) throw new Error('Chat root is missing.');

createRoot(root).render(
  <StrictMode>
    <ChatPanel client={client} title="Ask Formation" />
  </StrictMode>,
);
