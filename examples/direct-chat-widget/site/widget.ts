import styles from './widget.css';
import { readEventStream, type WidgetEvent } from './stream.js';

const tooltipArtworkUrl = new URL('./agent-shadow-tooltip.webp', import.meta.url).href;

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface StoredChat {
  conversationId: string;
  visitorId: string;
  messages: Message[];
}

class FormationChatWidget extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private readonly endpoint: string;
  private readonly storageKey: string;
  private chat: StoredChat;
  private open = false;
  private tooltipExpanded = false;
  private busy = false;
  private abort: AbortController | undefined;

  constructor() {
    super();
    this.endpoint = new URL(
      this.getAttribute('endpoint') ?? '/api/chat',
      window.location.href,
    ).href;
    this.storageKey = `formation-direct-chat:${this.endpoint}`;
    this.chat = this.loadChat();
    const launcherType = this.getAttribute('launcher-type') === 'button' ? 'button' : 'agent';
    const launcherImage = this.getAttribute('launcher-image');
    const launcherTooltip = (
      this.getAttribute('launcher-tooltip') ?? "Ceci n'est pas une chatbot."
    ).trim();
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
          <div><strong>${escapeHtml(this.getAttribute('title') ?? 'Ask us')}</strong><span>Usually replies in moments</span></div>
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
    this.abort?.abort();
  }

  private bind(): void {
    this.launcher.addEventListener('click', () => this.setOpen(!this.open));
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
    this.chat.messages.push({ role: 'user', text });
    const requestMessages = this.chat.messages.slice(-30);
    const assistant: Message = { role: 'assistant', text: '' };
    this.chat.messages.push(assistant);
    this.setStatus('Thinking…');
    this.renderMessages();
    this.updateControls();
    this.abort = new AbortController();

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: this.chat.conversationId,
          visitorId: this.chat.visitorId,
          messages: requestMessages,
        }),
        signal: this.abort.signal,
      });
      if (!response.ok) throw new Error(`Chat request failed with ${response.status}.`);
      await readEventStream(response, (event) => this.applyEvent(event, assistant));
      if (!assistant.text.trim()) throw new Error('The agent returned no answer.');
      this.setStatus('');
      this.saveChat();
    } catch (error) {
      if (this.abort.signal.aborted) return;
      assistant.text = 'Sorry, I could not reach the assistant. Please try again.';
      this.setStatus(error instanceof Error ? error.message : 'The chat request failed.');
    } finally {
      this.busy = false;
      this.abort = undefined;
      this.renderMessages();
      this.updateControls();
      this.input.focus();
    }
  }

  private applyEvent(event: WidgetEvent, assistant: Message): void {
    if (
      event.type === 'message.delta' &&
      isRecord(event.data) &&
      typeof event.data.delta === 'string'
    ) {
      assistant.text += event.data.delta;
      this.setStatus('');
      this.renderMessages();
    } else if (
      event.type === 'tool.started' &&
      isRecord(event.data) &&
      typeof event.data.label === 'string'
    ) {
      this.setStatus(`${event.data.label}…`);
    } else if (event.type === 'run.failed') {
      throw new Error('The assistant could not complete this request.');
    }
  }

  private clear(): void {
    this.abort?.abort();
    this.chat = newChat();
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Storage is optional.
    }
    this.setStatus('');
    this.renderMessages();
    this.input.focus();
  }

  private loadChat(): StoredChat {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
      if (isStoredChat(value)) return { ...value, messages: value.messages.slice(-30) };
    } catch {
      // Storage is optional.
    }
    return newChat();
  }

  private saveChat(): void {
    this.chat.messages = this.chat.messages.filter(({ text }) => text.trim()).slice(-30);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.chat));
    } catch {
      // Storage is optional.
    }
  }

  private renderMessages(): void {
    this.messages.replaceChildren();
    if (this.chat.messages.length === 0) {
      const welcome = document.createElement('p');
      welcome.className = 'welcome';
      welcome.textContent = this.getAttribute('welcome') ?? 'What can we help you with?';
      this.messages.append(welcome);
      return;
    }
    for (const message of this.chat.messages) {
      const bubble = document.createElement('p');
      bubble.className = `message ${message.role}`;
      bubble.textContent = message.text || '…';
      this.messages.append(bubble);
    }
    this.messages.scrollTop = this.messages.scrollHeight;
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

function newChat(): StoredChat {
  return { conversationId: crypto.randomUUID(), visitorId: crypto.randomUUID(), messages: [] };
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

function isStoredChat(value: unknown): value is StoredChat {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.visitorId === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (message) =>
        isRecord(message) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string',
    )
  );
}

function requiredElement<T extends Element>(root: ShadowRoot, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Widget element missing: ${selector}`);
  return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

customElements.define('formation-chat-widget', FormationChatWidget);
