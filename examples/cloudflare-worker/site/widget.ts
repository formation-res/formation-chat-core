import {
  createChatClient,
  createHttpChatTransport,
  type ChatClient,
  type ChatStorage,
  type PersistedChatState,
  type ChatState,
} from '@formation-chat-core/browser-client';
import type { ContentPart, Message } from '@formation-chat-core/protocol';

import styles from './widget.css';

const earthTooltipArtworkUrl = new URL('./agent-shadow-tooltip-earth.webp', import.meta.url).href;
const tooltipArtworkUrls: ReadonlyMap<string, string> = new Map([
  ['earth', earthTooltipArtworkUrl],
  ['blue', new URL('./agent-shadow-tooltip-blue.webp', import.meta.url).href],
  ['dark-green', new URL('./agent-shadow-tooltip-dark-green.webp', import.meta.url).href],
  ['rgb', new URL('./agent-shadow-tooltip-rgb.webp', import.meta.url).href],
  ['light', new URL('./agent-shadow-tooltip-light.webp', import.meta.url).href],
  ['rgb-neon', new URL('./agent-shadow-tooltip-rgb-neon.webp', import.meta.url).href],
] as const);

interface WidgetConfiguration {
  widgetKey: string;
  siteKey: string;
  agent: string;
  agentLabel: string;
  theme: string;
  launcher: string;
  placement: string;
  transportBaseUrl: string;
}

class FormationChatWidget extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private client: ChatClient | undefined;
  private unsubscribe: (() => void) | undefined;
  private state: ChatState | undefined;
  private storageKey: string | undefined;
  private open = false;
  private tooltipExpanded = false;
  private busy = false;

  constructor() {
    super();
    const launcherType = this.getAttribute('launcher-type') === 'button' ? 'button' : 'agent';
    const launcherImage = this.getAttribute('launcher-image');
    const launcherTooltip = (
      this.getAttribute('launcher-tooltip') ?? `"Ceci n'est pas une chatbot."`
    ).trim();
    const artworkKey = this.getAttribute('artwork-key')?.trim().toLowerCase() ?? 'earth';
    const tooltipArtworkUrl = tooltipArtworkUrls.get(artworkKey) ?? earthTooltipArtworkUrl;
    const launcherClass =
      launcherType === 'button' ? 'launcher-text-button' : 'launcher-agent-button';
    const launcherShellClass =
      launcherType === 'button' ? 'launcher-shell-text' : 'launcher-shell-agent';
    const launcherContent =
      launcherType === 'button'
        ? `<span class="launcher-text">${escapeHtml(this.getAttribute('launcher-text') ?? 'Chat')}</span>`
        : launcherImage
          ? `<img class="launcher-image" src="${escapeAttribute(launcherImage)}" alt="">`
          : defaultAgentLauncher();
    const launcherTooltipMarkup = launcherTooltip
      ? `<span class="launcher-tooltip" id="launcher-tooltip" aria-label="Agent artwork preview">
          <span class="launcher-tooltip-artwork-frame">
            <img class="launcher-tooltip-artwork" src="${escapeAttribute(tooltipArtworkUrl)}" alt="">
            <span class="launcher-tooltip-credit">Artwork - in respectful admiration, inspired by René Magritte</span>
            <button class="launcher-tooltip-expand" type="button" aria-label="Enlarge artwork" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"></path>
              </svg>
            </button>
          </span>
          <span class="launcher-tooltip-copy">
            <strong class="launcher-tooltip-title" id="launcher-tooltip-title">${escapeHtml(launcherTooltip)}</strong>
          </span>
        </span>`
      : '';
    const launcherDescription = launcherTooltip ? ' aria-describedby="launcher-tooltip-title"' : '';
    this.root.innerHTML = `
      <style>${styles}</style>
      <span class="launcher-shell ${launcherShellClass}">
        <button class="launcher ${launcherClass}" type="button" aria-expanded="false" aria-label="Open chat"${launcherDescription}>
          ${launcherContent}
        </button>
        ${launcherTooltipMarkup}
      </span>
      <section class="panel" aria-label="${escapeAttribute(this.getAttribute('title') ?? 'Ask us')}" hidden>
        <header>
          <div class="header-copy">
            <span class="header-live-dot" aria-hidden="true"></span>
            <strong>${escapeHtml(this.getAttribute('title') ?? 'Ask us')}</strong>
          </div>
          <div class="header-actions">
            <button class="clear" type="button">Clear</button>
            <button class="close" type="button" aria-label="Close chat">
              <svg class="close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 5 19 19M19 5 5 19"></path>
              </svg>
            </button>
          </div>
        </header>
        <div class="messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
        <p class="status" role="status"></p>
        <form>
          <label for="message">Message</label>
          <textarea id="message" rows="1" maxlength="4000" placeholder="Type your question…" required></textarea>
          <button class="send" type="submit" aria-label="Send message">Send</button>
        </form>
        <small>Answers may be inaccurate. Avoid sharing sensitive information.</small>
      </section>`;
    this.bind();
    this.renderMessages();
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.client?.destroy();
  }

  private bind(): void {
    this.launcher.addEventListener('click', () => this.setOpen(!this.open));
    this.launcher.addEventListener('blur', () => {
      this.launcherShell.classList.remove('suppress-tooltip');
    });
    this.launcherShell.addEventListener('pointerenter', () => {
      this.launcherShell.classList.remove('suppress-tooltip');
    });
    this.tooltip?.addEventListener('click', () => {
      this.setTooltipExpanded(!this.tooltipExpanded);
    });
    this.launcherShell.addEventListener('pointerleave', () => {
      this.setTooltipExpanded(false);
      this.tooltipExpandButton?.blur();
    });
    this.tooltip?.addEventListener('pointerleave', () => this.setTooltipExpanded(false));
    this.root.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === 'Escape' && this.tooltipExpanded) {
        this.setTooltipExpanded(false);
        this.tooltipExpandButton?.focus();
      }
    });
    this.closeButton.addEventListener('click', () => this.setOpen(false));
    this.clearButton.addEventListener('click', () => this.clear());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });
  }

  private setOpen(value: boolean): void {
    this.setTooltipExpanded(false);
    if (!value) this.launcherShell.classList.add('suppress-tooltip');
    this.open = value;
    this.panel.hidden = !value;
    this.launcher.setAttribute('aria-expanded', String(value));
    this.launcher.setAttribute('aria-label', value ? 'Close chat' : 'Open chat');
    if (value) this.input.focus();
    else this.launcher.focus();
  }

  private setTooltipExpanded(value: boolean): void {
    const tooltip = this.tooltip;
    const button = this.tooltipExpandButton;
    if (!tooltip || !button) return;
    this.tooltipExpanded = value;
    tooltip.classList.toggle('is-expanded', value);
    button.setAttribute('aria-expanded', String(value));
    button.setAttribute('aria-label', value ? 'Reduce artwork' : 'Enlarge artwork');
  }

  private async submit(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.input.value = '';
    this.setStatus('Thinking…');
    this.updateControls();
    try {
      const client = await this.ensureClient();
      if (!client.getState().conversation) await client.createConversation();
      await client.sendMessage({ parts: [{ type: 'text', text }] });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'The chat request failed.');
    } finally {
      this.busy = false;
      this.updateControls();
      this.input.focus();
    }
  }

  private async ensureClient(): Promise<ChatClient> {
    if (this.client) return this.client;
    const config = await this.loadConfiguration();
    const transport = createHttpChatTransport({
      baseUrl: config.transportBaseUrl,
      fetch: (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.pathname === '/v1/sessions') {
          url.searchParams.set('widgetKey', config.widgetKey);
          url.searchParams.set('agent', config.agent);
        }
        return fetch(url, init);
      },
    });
    this.storageKey = `formation-chat-widget:${config.widgetKey}:${config.agent}`;
    const storage = widgetStorage(this.storageKey);
    const client = createChatClient({
      siteKey: config.siteKey,
      transport,
      storage,
    });
    this.unsubscribe = client.subscribe((state) => {
      this.state = state;
      this.renderMessages();
      this.updateStatusFromState(state);
    });
    await client.start();
    this.client = client;
    this.state = client.getState();
    this.renderMessages();
    return client;
  }

  private async loadConfiguration(): Promise<WidgetConfiguration> {
    const scriptUrl = new URL(widgetScriptUrl());
    const endpoint = new URL('/widget/config', scriptUrl);
    const params = {
      widgetKey: this.getAttribute('widget-key') ?? 'main-chat',
      agent: this.getAttribute('agent') ?? 'support',
      theme: this.getAttribute('theme') ?? undefined,
      launcher: this.getAttribute('launcher') ?? undefined,
      placement: this.getAttribute('placement') ?? undefined,
      version: this.getAttribute('version') ?? undefined,
    };
    for (const [key, value] of Object.entries(params)) {
      if (value) endpoint.searchParams.set(key, value);
    }
    const response = await fetch(endpoint, { credentials: 'omit' });
    if (!response.ok) throw new Error('Widget configuration failed.');
    return (await response.json()) as WidgetConfiguration;
  }

  private clear(): void {
    this.client?.destroy();
    this.unsubscribe?.();
    if (this.storageKey) localStorage.removeItem(this.storageKey);
    this.client = undefined;
    this.unsubscribe = undefined;
    this.state = undefined;
    this.setStatus('');
    this.renderMessages();
    this.input.focus();
  }

  private renderMessages(): void {
    this.messages.replaceChildren();
    const rendered = renderedMessages(this.state);
    if (rendered.length === 0) {
      const welcome = document.createElement('p');
      welcome.className = 'welcome';
      welcome.textContent = this.getAttribute('welcome') ?? 'What can we help you with?';
      this.messages.append(welcome);
      return;
    }
    for (const message of rendered) {
      const bubble = document.createElement('p');
      bubble.className = `message ${message.role}`;
      bubble.textContent = message.text || '…';
      this.messages.append(bubble);
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private updateStatusFromState(state: ChatState): void {
    if (this.busy) return;
    if (state.phase === 'streaming') this.setStatus('Thinking…');
    else if (state.phase === 'reconnecting') this.setStatus('Reconnecting…');
    else if (state.error) this.setStatus(state.error.message);
    else this.setStatus('');
  }

  private updateControls(): void {
    this.input.disabled = this.busy;
    this.sendButton.disabled = this.busy;
    this.clearButton.disabled = this.busy;
  }

  private setStatus(value: string): void {
    this.status.textContent = value;
  }

  private get launcher() {
    return requiredElement<HTMLButtonElement>(this.root, '.launcher');
  }
  private get launcherShell() {
    return requiredElement<HTMLElement>(this.root, '.launcher-shell');
  }
  private get tooltip() {
    return this.root.querySelector<HTMLElement>('.launcher-tooltip');
  }
  private get tooltipExpandButton() {
    return this.root.querySelector<HTMLButtonElement>('.launcher-tooltip-expand');
  }
  private get panel() {
    return requiredElement<HTMLElement>(this.root, '.panel');
  }
  private get closeButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.close');
  }
  private get clearButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.clear');
  }
  private get form() {
    return requiredElement<HTMLFormElement>(this.root, 'form');
  }
  private get input() {
    return requiredElement<HTMLTextAreaElement>(this.root, 'textarea');
  }
  private get sendButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.send');
  }
  private get messages() {
    return requiredElement<HTMLElement>(this.root, '.messages');
  }
  private get status() {
    return requiredElement<HTMLElement>(this.root, '.status');
  }
}

function renderedMessages(state: ChatState | undefined): Array<{ role: string; text: string }> {
  if (!state) return [];
  const messages = state.messages.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: messageText(message),
  }));
  for (const live of Object.values(state.liveMessages)) {
    messages.push({ role: 'assistant', text: live.text });
  }
  return messages.filter((message) => message.text.trim()).slice(-30);
}

function messageText(message: Message): string {
  return partsText(message.parts);
}

function partsText(parts: readonly ContentPart[]): string {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

function defaultAgentLauncher(): string {
  return `<span class="launcher-agent" aria-hidden="true">
    <svg viewBox="0 0 64 64" focusable="false">
      <path class="agent-antenna" d="M32 17V10"></path>
      <circle class="agent-signal" cx="32" cy="7" r="3"></circle>
      <rect class="agent-head" x="13.5" y="17" width="37" height="34" rx="14"></rect>
      <path class="agent-face" d="M18.5 29.5c6-6.5 21-6.5 27 0v9c-6 8-21 8-27 0z"></path>
      <circle class="agent-eye agent-eye-left" cx="26.5" cy="34" r="2.4"></circle>
      <circle class="agent-eye agent-eye-right" cx="37.5" cy="34" r="2.4"></circle>
      <path class="agent-smile" d="M27 40c3 1.6 7 1.6 10 0"></path>
    </svg>
  </span>`;
}

function requiredElement<T extends Element>(root: ShadowRoot, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Widget element missing: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

customElements.define('formation-chat-widget', FormationChatWidget);
autoCreateWidgetFromScript();

function widgetScriptUrl(): string {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript.src;
  const script = document.querySelector<HTMLScriptElement>('script[src$="/widget.js"]');
  return script?.src ?? window.location.href;
}

function autoCreateWidgetFromScript(): void {
  const script = document.querySelector<HTMLScriptElement>(
    'script[src$="/widget.js"][data-widget-key]',
  );
  if (!script || document.querySelector('formation-chat-widget')) return;
  const widget = document.createElement('formation-chat-widget');
  copyDatasetAttribute(script, widget, 'widgetKey', 'widget-key');
  copyDatasetAttribute(script, widget, 'agent', 'agent');
  copyDatasetAttribute(script, widget, 'theme', 'theme');
  copyDatasetAttribute(script, widget, 'launcher', 'launcher');
  copyDatasetAttribute(script, widget, 'placement', 'placement');
  copyDatasetAttribute(script, widget, 'version', 'version');
  copyDatasetAttribute(script, widget, 'artworkKey', 'artwork-key');
  document.body.append(widget);
}

function copyDatasetAttribute(
  script: HTMLScriptElement,
  element: HTMLElement,
  datasetName: string,
  attributeName: string,
): void {
  const value = script.dataset[datasetName];
  if (value) element.setAttribute(attributeName, value);
}

function widgetStorage(key: string): ChatStorage {
  return {
    async load() {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        return isPersistedChatState(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },
    async save(_siteKey: string, state: PersistedChatState) {
      localStorage.setItem(key, JSON.stringify(state));
    },
  };
}

function isPersistedChatState(value: unknown): value is PersistedChatState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    (value.browserIdentity === undefined || typeof value.browserIdentity === 'string') &&
    (value.conversationId === undefined || typeof value.conversationId === 'string') &&
    (value.lastEventId === undefined || typeof value.lastEventId === 'string') &&
    (value.lastEventSequence === undefined || typeof value.lastEventSequence === 'number')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
