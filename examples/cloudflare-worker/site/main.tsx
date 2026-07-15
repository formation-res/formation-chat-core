import { createChatClient, createHttpChatTransport } from '@formation-chat-core/browser-client';
import { ChatPanel } from '@formation-chat-core/ui-react';
import '@formation-chat-core/ui-react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './site.css';

const client = createChatClient({
  siteKey: 'same-origin-gateway',
  transport: createHttpChatTransport({ baseUrl: location.origin }),
});
const root = document.getElementById('chat-root');
if (!root) throw new Error('Chat root is missing.');

createRoot(root).render(
  <StrictMode>
    <ChatPanel client={client} title="Ask Formation" />
  </StrictMode>,
);
