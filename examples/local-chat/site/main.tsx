import { createChatClient, createHttpChatTransport } from '@formation-chat-core/browser-client';
import { ChatPanel } from '@formation-chat-core/ui-react';
import '@formation-chat-core/ui-react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './site.css';

declare global {
  interface Window {
    __FORMATION_CHAT_LOCAL_CONFIG__?: { siteKey: string };
  }
}

const configuration = window.__FORMATION_CHAT_LOCAL_CONFIG__;
if (!configuration) throw new Error('Local Chat configuration is missing.');

const client = createChatClient({
  siteKey: configuration.siteKey,
  transport: createHttpChatTransport({ baseUrl: window.location.origin }),
});
const root = document.getElementById('root');
if (!root) throw new Error('Local Chat root is missing.');

createRoot(root).render(
  <StrictMode>
    <main className="local-shell">
      <header className="local-header">
        <div>
          <p className="local-eyebrow">Formation Chat Core</p>
          <h1>Local integration playground</h1>
          <p>Messages use the same browser client and React panel intended for a real website.</p>
        </div>
        <dl className="local-details" aria-label="Local connection">
          <div>
            <dt>Site</dt>
            <dd>{configuration.siteKey}</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>same-origin proxy</dd>
          </div>
        </dl>
      </header>
      <section className="local-chat" aria-label="Chat example">
        <ChatPanel client={client} title="Ask the local agent" />
      </section>
    </main>
  </StrictMode>,
);

window.addEventListener('pagehide', () => client.destroy(), { once: true });
