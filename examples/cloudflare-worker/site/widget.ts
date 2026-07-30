import {
  createChatClient,
  createHttpChatTransport,
  type ChatClient,
  type ChatState,
  type ChatStorage,
  type PersistedChatState,
} from '@formation-chat-core/browser-client';
import type { ContentPart, Message } from '@formation-chat-core/protocol';

import styles from './widget.css';
import {
  AGENT_AVATAR_COUNT,
  AVATARS_PER_SHEET as USER_AVATARS_PER_SHEET,
  USER_AVATAR_COUNT,
  type AvatarRole,
  avatarCoordinates,
  avatarStorageKey,
  selectStoredConversationAvatars,
  storeAvatarIndex,
  userAvatarSheet,
} from './widget-avatar.js';
import { createWidgetAnalytics, type WidgetAnalyticsReporter } from './widget-analytics.js';

type WidgetTheme = 'hot-pink' | 'blue' | 'dark-green' | 'light' | 'rgb-neon';
type WidgetColorMode = 'light' | 'dark';

const agentSpriteUrls: Readonly<Record<WidgetTheme, string>> = {
  'hot-pink': new URL('./formation-agent-sprite-v2.webp', import.meta.url).href,
  blue: new URL('./formation-agent-sprite-blue.webp', import.meta.url).href,
  'dark-green': new URL('./formation-agent-sprite-dark-green.webp', import.meta.url).href,
  light: new URL('./formation-agent-sprite-light.webp', import.meta.url).href,
  'rgb-neon': new URL('./formation-agent-sprite-rgb-neon.webp', import.meta.url).href,
};
const userSpriteUrls = {
  people: new URL('./formation-user-sprite.webp', import.meta.url).href,
  'people-alt': new URL('./formation-user-sprite-alt.webp', import.meta.url).href,
  animals: new URL('./formation-user-animal-sprite.webp', import.meta.url).href,
} as const;
const themeTokens: Readonly<
  Record<
    WidgetTheme,
    { accent: string; accentStrong: string; accentStrongDark: string; dark: string }
  >
> = {
  'hot-pink': {
    accent: '#ff75ad',
    accentStrong: '#c72d70',
    accentStrongDark: '#ff9bc4',
    dark: '#202723',
  },
  blue: {
    accent: '#a9d8ff',
    accentStrong: '#236ebd',
    accentStrongDark: '#8bc5ff',
    dark: '#102b47',
  },
  'dark-green': {
    accent: '#74d887',
    accentStrong: '#217938',
    accentStrongDark: '#74d887',
    dark: '#071a11',
  },
  light: {
    accent: '#e2e2df',
    accentStrong: '#626865',
    accentStrongDark: '#c9cecb',
    dark: '#2d302f',
  },
  'rgb-neon': {
    accent: '#ff4fa3',
    accentStrong: '#08758f',
    accentStrongDark: '#68d7f3',
    dark: '#0b0b17',
  },
};
const colorModeTokens: Readonly<
  Record<
    WidgetColorMode,
    {
      ink: string;
      paper: string;
      surface: string;
      muted: string;
      line: string;
      accentInk: string;
      hover: string;
      fieldLine: string;
    }
  >
> = {
  light: {
    ink: '#1b211e',
    paper: '#f7f6f1',
    surface: '#ffffff',
    muted: '#687069',
    line: '#d9ddd7',
    accentInk: '#101713',
    hover: '#f0f2ef',
    fieldLine: '#cbd1cb',
  },
  dark: {
    ink: '#f5f7f6',
    paper: '#1b241f',
    surface: '#252f29',
    muted: '#bdc8c1',
    line: '#46554c',
    accentInk: '#101713',
    hover: '#313e36',
    fieldLine: '#64746a',
  },
};
const agentFlowArtworkUrls: Readonly<Record<WidgetTheme, string>> = {
  'hot-pink': new URL('./agent-flow-diagram-hot-pink.webp', import.meta.url).href,
  blue: new URL('./agent-flow-diagram-blue.webp', import.meta.url).href,
  'dark-green': new URL('./agent-flow-diagram-dark-green.webp', import.meta.url).href,
  light: new URL('./agent-flow-diagram-light.webp', import.meta.url).href,
  'rgb-neon': new URL('./agent-flow-diagram-rgb-neon.webp', import.meta.url).href,
};
const emojis = [
  '👋',
  '🙂',
  '😀',
  '😄',
  '😂',
  '😊',
  '😍',
  '🥰',
  '😎',
  '🤔',
  '😅',
  '😢',
  '😭',
  '😮',
  '👍',
  '👎',
  '🙌',
  '👏',
  '🎉',
  '❤️',
  '🔥',
  '💡',
  '✅',
  '🚀',
] as const;

type WidgetPage = 'chat' | 'menu' | 'about' | 'mail' | 'avatar';

interface WidgetConfiguration {
  widgetKey: string;
  siteKey: string;
  agent: string;
  agentLabel: string;
  emailHandoff?: boolean;
  version: string;
  theme: string;
  launcher: string;
  placement: string;
  transportBaseUrl: string;
  analytics?: {
    endpoint: string;
    siteId: string;
  };
}

interface RenderedMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt: string;
}

class FormationChatWidget extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['color-mode'];
  }

  private readonly root = this.attachShadow({ mode: 'open' });
  private readonly messageTimes = new Map<string, string>();
  private client: ChatClient | undefined;
  private clientPromise: Promise<ChatClient> | undefined;
  private unsubscribe: (() => void) | undefined;
  private state: ChatState | undefined;
  private configuration: WidgetConfiguration | undefined;
  private storageKey: string | undefined;
  private analytics: WidgetAnalyticsReporter | undefined;
  private currentPage: WidgetPage = 'chat';
  private avatarPickerRole: AvatarRole = 'agent';
  private avatarPickerReturnPage: WidgetPage = 'chat';
  private notice = '';
  private widgetTheme: WidgetTheme = 'hot-pink';
  private widgetColorMode: WidgetColorMode = 'light';
  private agentAvatarIndex = 0;
  private userAvatarIndex = 0;
  private avatarWidgetStorageKey: string | undefined;
  private open = false;
  private busy = false;
  private emojiOpen = false;
  private maximized = false;
  private launcherTooltipDefault = '';
  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.emojiOpen) return;
    const path = event.composedPath();
    if (path.includes(this.emojiToggle) || path.includes(this.emojiBoard)) return;
    this.setEmojiOpen(false);
  };

  connectedCallback(): void {
    if (this.root.childNodes.length > 0) {
      document.addEventListener('pointerdown', this.onDocumentPointerDown);
      return;
    }
    const launcherSetting =
      this.getAttribute('launcher-type') ?? this.getAttribute('launcher') ?? 'agent';
    const launcherType =
      launcherSetting === 'button' || launcherSetting === 'text' ? 'button' : 'agent';
    const launcherImage = this.getAttribute('launcher-image')?.trim();
    const agentImage = this.getAttribute('agent-image')?.trim() || launcherImage;
    const provisionalStorageKey = this.widgetStorageKey(
      this.getAttribute('widget-key') ?? 'main-chat',
      this.getAttribute('agent') ?? 'support',
    );
    this.avatarWidgetStorageKey = provisionalStorageKey;
    this.selectSessionAvatars(provisionalStorageKey);
    this.widgetTheme = normalizeTheme(this.getAttribute('theme'));
    this.widgetColorMode = normalizeColorMode(this.getAttribute('color-mode'));
    const launcherTooltip = (
      this.getAttribute('launcher-tooltip') ?? 'Start a conversation'
    ).trim();
    this.launcherTooltipDefault = launcherTooltip;
    const title = this.getAttribute('title') ?? 'Ask us';
    const privacyUrl = resolvePrivacyPolicyUrl(this.getAttribute('privacy-policy-url'));
    const privacyPolicyMarkup = privacyUrl
      ? `<a href="${escapeAttribute(privacyUrl)}" target="_blank" rel="noopener noreferrer">privacy policy</a>`
      : '<span>privacy policy</span>';
    const launcherContent =
      launcherType === 'button'
        ? `<span class="launcher-text">${escapeHtml(this.getAttribute('launcher-text') ?? 'Chat')}</span>`
        : `<span class="launcher-halo" aria-hidden="true"></span>
           ${this.agentProfileMarkup('launcher-image', launcherImage, false)}
           <span class="launcher-presence" aria-hidden="true"></span>
           <span class="launcher-collapse" aria-hidden="true">${collapseIcon()}</span>`;
    const launcherDescription = launcherTooltip ? ' aria-describedby="launcher-tooltip"' : '';
    const launcherTooltipMarkup = launcherTooltip
      ? `<span class="launcher-tooltip" id="launcher-tooltip">${escapeHtml(launcherTooltip)}</span>`
      : '';

    this.root.innerHTML = `
      <style>${styles}</style>
      <span class="launcher-shell launcher-shell-${launcherType}">
        <button class="launcher launcher-${launcherType}-button" type="button" aria-expanded="false" aria-label="Open chat"${launcherDescription}>
          ${launcherContent}
        </button>
        ${launcherTooltipMarkup}
      </span>
      <section class="panel" aria-label="${escapeAttribute(title)}" hidden>
        <header>
          <button class="back" type="button" aria-label="Go back" hidden>${backIcon()}</button>
          <div class="header-identity">
            ${this.agentProfileMarkup('header-avatar', agentImage)}
            <span class="header-copy">
              <strong>${escapeHtml(title)}</strong>
              <span><i aria-hidden="true"></i> Online</span>
            </span>
          </div>
          <div class="header-actions">
            <button class="maximize" type="button" aria-label="Maximize chat" aria-pressed="false">
              <span class="maximize-icon">${maximizeIcon()}</span>
              <span class="restore-icon">${restoreIcon()}</span>
            </button>
            <button class="menu" type="button" aria-label="Open menu" aria-expanded="false">${menuIcon()}</button>
            <button class="close" type="button" aria-label="Close chat">${closeIcon()}</button>
          </div>
        </header>
        <div class="view-stack">
          <section class="widget-page chat-page" data-page="chat">
            <div class="messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
            <p class="status" role="status"></p>
            <form class="message-form" aria-label="Send a message">
              <label for="message">Message</label>
              <div class="composer">
                <button class="emoji-toggle" type="button" aria-label="Choose an emoji" aria-expanded="false">${smileIcon()}</button>
                <div class="emoji-board" role="dialog" aria-label="Emoji picker" hidden>
                  ${emojis
                    .map(
                      (emoji) =>
                        `<button type="button" data-emoji="${emoji}" aria-label="Insert ${emoji}">${emoji}</button>`,
                    )
                    .join('')}
                </div>
                <textarea id="message" rows="1" maxlength="4000" placeholder="Type your message…" required></textarea>
                <button class="send" type="submit" aria-label="Send message">${sendIcon()}</button>
              </div>
            </form>
            <small>AI can make mistakes. Avoid sharing sensitive information.</small>
          </section>
          <section class="widget-page option-page menu-page" data-page="menu" hidden>
            <div class="page-heading">
              <span>Conversation</span>
              <h2>More options</h2>
            </div>
            <nav class="option-list" aria-label="Conversation options">
              <button class="print-option" type="button">${printIcon()}<span><strong>Print conversation</strong><small>Create a clean, dated transcript.</small></span>${chevronIcon()}</button>
              <button class="mail-option" type="button" data-open-page="mail" disabled>${mailIcon()}<span><strong>Mail me this conversation</strong><small>Continue this chat with the agent by email.</small></span>${chevronIcon()}</button>
              <button type="button" data-open-page="about">${infoIcon()}<span><strong>About this chat</strong><small>How this AI conversation works.</small></span>${chevronIcon()}</button>
              <button class="clear" type="button">${trashIcon()}<span><strong>Start a new conversation</strong><small>Clear this chat on this browser.</small></span>${chevronIcon()}</button>
            </nav>
          </section>
          <section class="widget-page option-page about-page" data-page="about" hidden>
            <div class="page-heading">
              <span>About</span>
              <h2>How your agent works</h2>
            </div>
            <div class="about-agent">
              ${this.agentProfileMarkup('about-agent-avatar', agentImage)}
              <div><strong data-agent-name>${escapeHtml(title)}</strong><span>AI conversation agent</span></div>
            </div>
            <p class="about-explanation">Your message is combined with the conversation context, trusted knowledge and available tools before the agent creates a response for chat or email.</p>
            <button class="artwork-card" type="button" aria-label="Maximize chat to enlarge agent flow diagram" aria-expanded="false">
              <span class="artwork-frame">
                <img src="${escapeAttribute(agentFlowArtworkUrls[this.widgetTheme])}" alt="Pixel-art flow from a user message through context, knowledge, tools and an AI agent to a chat or mail response">
                <span class="artwork-expand">${expandIcon()}</span>
              </span>
            </button>
            <p class="about-privacy">Responses are generated and may be inaccurate. Please avoid sending sensitive information. See the ${privacyPolicyMarkup} for further details.</p>
          </section>
          <section class="widget-page option-page avatar-page" data-page="avatar" hidden>
            <div class="page-heading">
              <span>Profile</span>
              <h2 data-avatar-picker-heading>Choose an agent avatar</h2>
              <p data-avatar-picker-description>Select the profile this agent uses in the current conversation.</p>
            </div>
            <div class="avatar-gallery" role="list" aria-label="Available agent avatars">
              ${avatarGalleryMarkup()}
            </div>
          </section>
          <section class="widget-page option-page mail-page" data-page="mail" hidden>
            <div class="page-heading">
              <span>Keep the conversation</span>
              <h2>Send it to your inbox</h2>
              <p>Your agent will format this conversation, add a relevant follow-up question and email it to you so you can continue there.</p>
            </div>
            <form class="mail-form">
              <label for="conversation-email">Email address</label>
              <input id="conversation-email" name="email" type="email" autocomplete="email" maxlength="320" placeholder="you@example.com" required>
              <button type="submit">Email conversation ${sendIcon()}</button>
            </form>
            <p class="mail-status" role="status"></p>
            <p class="privacy-note">${lockIcon()} Your email is used to continue this conversation and is not posted as a chat message.</p>
          </section>
        </div>
      </section>`;
    this.applyAppearance();
    this.bind();
    document.addEventListener('pointerdown', this.onDocumentPointerDown);
    this.renderMessages();
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    this.unsubscribe?.();
    this.client?.destroy();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name !== 'color-mode' || oldValue === newValue) return;
    this.widgetColorMode = normalizeColorMode(newValue);
    if (this.root.childNodes.length > 0) this.applyAppearance();
  }

  private bind(): void {
    this.launcher.addEventListener('click', () => this.setOpen(!this.open));
    this.launcher.addEventListener('pointerenter', () => {
      void this.ensureClient().catch(() => undefined);
    });
    this.closeButton.addEventListener('click', () => this.setOpen(false));
    this.maximizeButton.addEventListener('click', () => this.setMaximized(!this.maximized));
    this.menuButton.addEventListener('click', () => this.showPage('menu'));
    this.backButton.addEventListener('click', () => {
      if (this.currentPage === 'avatar') this.showPage(this.avatarPickerReturnPage);
      else this.showPage(this.currentPage === 'menu' ? 'chat' : 'menu');
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-open-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.openPage;
        if (target === 'about' || target === 'mail') this.showPage(target);
      });
    });
    this.clearButton.addEventListener('click', () => this.clear());
    this.printButton.addEventListener('click', () => this.printConversation());
    this.artworkButton.addEventListener('click', () => this.setMaximized(!this.maximized));
    this.messageForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.mailForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.mailConversation();
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.messageForm.requestSubmit();
      }
    });
    this.emojiToggle.addEventListener('click', () => this.setEmojiOpen(!this.emojiOpen));
    this.emojiBoard.querySelectorAll<HTMLButtonElement>('[data-emoji]').forEach((button) => {
      button.addEventListener('click', () => this.insertEmoji(button.dataset.emoji ?? ''));
    });
    this.root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const pickerTrigger = event.target.closest<HTMLElement>('[data-avatar-picker]');
      const pickerRole = pickerTrigger?.dataset.avatarPicker;
      if (pickerRole === 'agent' || pickerRole === 'user') {
        this.openAvatarPicker(pickerRole);
        return;
      }
      const choice = event.target.closest<HTMLButtonElement>('[data-avatar-choice]');
      if (!choice) return;
      const index = Number(choice.dataset.avatarChoice);
      if (Number.isInteger(index)) this.chooseAvatar(index);
    });
    this.root.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return;
      if (this.maximized) this.setMaximized(false);
      else if (this.emojiOpen) this.setEmojiOpen(false);
      else if (this.currentPage !== 'chat') this.showPage('chat');
      else this.setOpen(false);
    });
  }

  private setOpen(value: boolean): void {
    this.open = value;
    this.panel.hidden = !value;
    this.launcher.setAttribute('aria-expanded', String(value));
    this.launcher.setAttribute('aria-label', value ? 'Minimize chat' : 'Open chat');
    if (value) {
      this.showPage('chat');
      void this.ensureClient().catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : 'The chat could not be loaded.');
      });
      this.input.focus();
    } else {
      if (this.maximized) this.setMaximized(false);
      this.setEmojiOpen(false);
      this.launcher.focus();
    }
  }

  private showPage(page: WidgetPage): void {
    this.currentPage = page;
    this.pages.forEach((element) => {
      element.hidden = element.dataset.page !== page;
    });
    this.backButton.hidden = page === 'chat';
    this.menuButton.hidden = page !== 'chat';
    this.menuButton.setAttribute('aria-expanded', String(page !== 'chat'));
    this.panel.dataset.activePage = page;
    const heading = this.root.querySelector<HTMLElement>(`[data-page="${page}"] h2`);
    if (page === 'chat') this.input.focus();
    else heading?.focus({ preventScroll: true });
  }

  private async submit(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.notice = '';
    this.setStatus('Thinking…');
    this.renderMessages();
    this.updateControls();
    try {
      const client = await this.ensureClient();
      const contactRequest = client.getState().contactRequest;
      if (contactRequest) {
        if (!isEmail(text)) {
          this.setStatus('Enter a valid email address so our team can follow up.');
          return;
        }
        await client.submitStructuredInput(contactRequest.requestId, {
          value: text,
          consent: true,
        });
        this.input.value = '';
        return;
      }
      await this.ensureConversation(client);
      await client.sendMessage({ parts: [{ type: 'text', text }] });
      this.input.value = '';
      this.analytics?.messageSent(client.getState());
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'The chat request failed.');
    } finally {
      this.busy = false;
      this.renderMessages();
      this.updateControls();
      this.input.focus();
    }
  }

  private async mailConversation(): Promise<void> {
    const email = this.mailInput.value.trim();
    if (!isEmail(email) || this.busy) {
      this.setMailStatus('Enter a valid email address.');
      return;
    }
    this.busy = true;
    this.setMailStatus('Preparing your email handoff…');
    this.updateControls();
    try {
      const client = await this.ensureClient();
      await this.ensureConversation(client);
      await client.createEmailHandoff({ email, consent: true });
      this.mailInput.value = '';
      this.showPage('chat');
      this.notice = 'The email agent is preparing your conversation summary.';
      this.setStatus(this.notice);
    } catch (error) {
      this.setMailStatus(
        error instanceof Error ? error.message : 'The email request could not be sent.',
      );
    } finally {
      this.busy = false;
      this.updateControls();
    }
  }

  private async ensureConversation(client: ChatClient): Promise<void> {
    if (client.getState().conversation) return;
    const conversation = await client.createConversation();
    this.analytics?.conversationStarted(conversation.conversationId, client.getState());
  }

  private ensureClient(): Promise<ChatClient> {
    if (this.client) return Promise.resolve(this.client);
    this.clientPromise ??= this.startClient().catch((error: unknown) => {
      this.clientPromise = undefined;
      throw error;
    });
    return this.clientPromise;
  }

  private async startClient(): Promise<ChatClient> {
    if (this.client) return this.client;
    const config = await this.loadConfiguration();
    this.configuration = config;
    this.applyConfiguration(config);
    this.analytics = config.analytics
      ? createWidgetAnalytics({
          endpoint: config.analytics.endpoint,
          siteId: config.analytics.siteId,
          widgetId: config.widgetKey,
          agentAlias: config.agent,
          widgetVersion: config.version,
        })
      : undefined;
    const transport = createHttpChatTransport({
      baseUrl: config.transportBaseUrl,
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === '/v1/sessions') {
          url.searchParams.set('widgetKey', config.widgetKey);
          url.searchParams.set('agent', config.agent);
        }
        return fetch(url, init);
      },
    });
    this.storageKey = `formation-chat-widget:${config.widgetKey}:${config.agent}`;
    this.avatarWidgetStorageKey = this.storageKey;
    this.selectSessionAvatars(this.storageKey);
    this.refreshProfiles();
    const client = createChatClient({
      siteKey: config.siteKey,
      transport,
      storage: widgetStorage(this.storageKey),
    });
    this.unsubscribe = client.subscribe((state) => {
      this.state = state;
      this.analytics?.observe(state);
      this.renderMessages();
      this.updateLauncherTooltip();
      this.updateStatusFromState(state);
    });
    await client.start();
    this.analytics?.sessionStarted(client.getState());
    this.client = client;
    this.state = client.getState();
    this.renderMessages();
    this.updateLauncherTooltip();
    return client;
  }

  private async loadConfiguration(): Promise<WidgetConfiguration> {
    const endpoint = new URL('/widget/config', new URL(widgetScriptUrl()));
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

  private applyConfiguration(config: WidgetConfiguration): void {
    this.root.querySelectorAll<HTMLElement>('[data-agent-name]').forEach((element) => {
      element.textContent = config.agentLabel;
    });
    this.headerName.textContent = config.agentLabel;
    this.panel.setAttribute('aria-label', `Chat with ${config.agentLabel}`);
    this.updateControls();
    this.widgetTheme = normalizeTheme(config.theme);
    this.applyAppearance();
    this.refreshProfiles();
  }

  private applyAppearance(): void {
    const theme = themeTokens[this.widgetTheme];
    const mode = colorModeTokens[this.widgetColorMode];
    this.dataset.widgetTheme = this.widgetTheme;
    this.dataset.colorMode = this.widgetColorMode;
    this.style.colorScheme = this.widgetColorMode;
    this.style.setProperty('--chat-ink', mode.ink);
    this.style.setProperty('--chat-paper', mode.paper);
    this.style.setProperty('--chat-surface', mode.surface);
    this.style.setProperty('--chat-muted', mode.muted);
    this.style.setProperty('--chat-line', mode.line);
    this.style.setProperty('--chat-accent-ink', mode.accentInk);
    this.style.setProperty('--chat-hover', mode.hover);
    this.style.setProperty('--chat-field-line', mode.fieldLine);
    this.style.setProperty('--chat-accent', theme.accent);
    this.style.setProperty(
      '--chat-accent-strong',
      this.widgetColorMode === 'dark' ? theme.accentStrongDark : theme.accentStrong,
    );
    this.style.setProperty('--chat-dark', theme.dark);
    const artwork = this.root.querySelector<HTMLImageElement>('.artwork-frame img');
    if (artwork) artwork.src = agentFlowArtworkUrls[this.widgetTheme];
  }

  private clear(): void {
    this.client?.destroy();
    this.unsubscribe?.();
    if (this.storageKey) localStorage.removeItem(this.storageKey);
    if (this.avatarWidgetStorageKey) {
      localStorage.removeItem(avatarStorageKey(this.avatarWidgetStorageKey, 'agent'));
      localStorage.removeItem(avatarStorageKey(this.avatarWidgetStorageKey, 'user'));
      this.selectSessionAvatars(this.avatarWidgetStorageKey);
      this.refreshProfiles();
    }
    this.client = undefined;
    this.clientPromise = undefined;
    this.unsubscribe = undefined;
    this.state = undefined;
    this.analytics = undefined;
    this.configuration = undefined;
    this.notice = '';
    this.messageTimes.clear();
    this.setStatus('');
    this.showPage('chat');
    this.renderMessages();
    this.updateLauncherTooltip();
  }

  private renderMessages(): void {
    this.messages.replaceChildren();
    const rendered = renderedMessages(this.state, this.messageTimes);
    this.messages.append(this.welcomeCard());
    for (const message of rendered) this.messages.append(this.messageRow(message));
    if (this.busy || this.state?.phase === 'streaming') {
      this.messages.append(this.typingRow(this.busy ? 'Thinking' : 'Typing'));
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private welcomeCard(): HTMLElement {
    const card = document.createElement('article');
    card.className = 'welcome';
    const image = this.createAgentProfile('welcome-avatar');
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = this.agentName;
    const message = document.createElement('p');
    message.textContent = this.getAttribute('welcome') ?? 'What can we help you with?';
    const about = document.createElement('button');
    about.className = 'welcome-about';
    about.type = 'button';
    about.innerHTML = `${infoIcon()}<span>Learn about this chat</span>`;
    about.addEventListener('click', () => this.showPage('about'));
    copy.append(name, message, about);
    card.append(image, copy);
    return card;
  }

  private messageRow(message: RenderedMessage): HTMLElement {
    const row = document.createElement('article');
    row.className = `message-row ${message.role}`;
    row.setAttribute('aria-label', message.role === 'assistant' ? this.agentName : 'You');
    const avatar =
      message.role === 'assistant'
        ? this.createAgentProfile('message-avatar')
        : this.createProfile('message-avatar', 'user');
    const content = document.createElement('div');
    content.className = 'message-content';
    const bubble = document.createElement('p');
    bubble.className = 'message';
    bubble.textContent = message.text;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const time = document.createElement('time');
    time.dateTime = message.createdAt;
    time.textContent = formatTime(message.createdAt);
    const copy = document.createElement('button');
    copy.className = 'message-copy';
    copy.type = 'button';
    copy.ariaLabel = 'Copy message';
    copy.innerHTML = copyIcon();
    copy.addEventListener('click', () => void this.copyMessage(message.text, copy));
    meta.append(time, copy);
    content.append(bubble, meta);
    row.append(avatar, content);
    return row;
  }

  private typingRow(label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'message-row assistant typing-row';
    row.setAttribute('role', 'status');
    row.setAttribute('aria-label', `${this.agentName} is ${label.toLowerCase()}`);
    const avatar = this.createAgentProfile('message-avatar');
    const bubble = document.createElement('div');
    bubble.className = 'typing-bubble';
    bubble.innerHTML = `<span class="typing-label">${label}</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
    row.append(avatar, bubble);
    return row;
  }

  private async copyMessage(text: string, button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      this.root.append(fallback);
      fallback.select();
      const copied = document.execCommand('copy');
      fallback.remove();
      if (!copied) {
        this.setStatus('This message could not be copied.');
        return;
      }
    }
    button.classList.add('is-copied');
    button.ariaLabel = 'Copied';
    window.setTimeout(() => {
      button.classList.remove('is-copied');
      button.ariaLabel = 'Copy message';
    }, 1400);
  }

  private printConversation(): void {
    const messages = renderedMessages(this.state, this.messageTimes);
    const printedAt = new Date();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      this.setStatus('Allow pop-ups to print this conversation.');
      this.showPage('chat');
      return;
    }
    printWindow.opener = null;
    const agentAvatar = this.printAvatarMarkup('agent');
    const transcript = messages
      .map(
        (message) => `<article class="${message.role}">
          ${this.printAvatarMarkup(message.role === 'assistant' ? 'agent' : 'user')}
          <div class="print-message"><div class="meta"><strong>${escapeHtml(message.role === 'assistant' ? this.agentName : 'You')}</strong><time>${escapeHtml(formatPrintTime(message.createdAt))}</time></div>
          <p>${escapeHtml(message.text).replaceAll('\n', '<br>')}</p></div>
        </article>`,
      )
      .join('');
    printWindow.document
      .write(`<!doctype html><html><head><title>Conversation with ${escapeHtml(this.agentName)}</title>
      <style>${printStyles()}</style></head><body><main>
      <header><div class="print-title">${agentAvatar}<div><p>Conversation transcript</p><h1>${escapeHtml(this.agentName)}</h1></div></div>
      <dl><div><dt>Date</dt><dd>${escapeHtml(printedAt.toLocaleDateString())}</dd></div><div><dt>Website</dt><dd>${escapeHtml(location.hostname)}</dd></div></dl></header>
      <section>${transcript || '<p class="empty">No messages yet.</p>'}</section>
      <footer>Generated from ${escapeHtml(location.hostname)} on ${escapeHtml(printedAt.toLocaleString())}.</footer>
      </main><script>window.addEventListener('load',()=>window.print());</script></body></html>`);
    printWindow.document.close();
  }

  private printAvatarMarkup(role: AvatarRole): string {
    const index = role === 'agent' ? this.agentAvatarIndex : this.userAvatarIndex;
    const override =
      role === 'agent'
        ? this.getAttribute('agent-image')?.trim() || this.getAttribute('launcher-image')?.trim()
        : undefined;
    if (override) {
      return `<span class="print-avatar custom-avatar" data-avatar-index="${index}"><img src="${escapeAttribute(override)}" alt=""></span>`;
    }
    const { column, row } = avatarCoordinates(index);
    return `<span class="print-avatar" data-avatar-index="${index}" style="--avatar-column:${column};--avatar-row:${row}"><img src="${escapeAttribute(this.profileSpriteUrl(role, index))}" alt=""></span>`;
  }

  private insertEmoji(emoji: string): void {
    const start = this.input.selectionStart;
    const end = this.input.selectionEnd;
    this.input.setRangeText(emoji, start, end, 'end');
    this.setEmojiOpen(false);
    this.input.focus();
  }

  private setEmojiOpen(value: boolean): void {
    this.emojiOpen = value;
    this.emojiBoard.hidden = !value;
    this.emojiToggle.setAttribute('aria-expanded', String(value));
  }

  private updateLauncherTooltip(): void {
    const tooltip = this.root.querySelector<HTMLElement>('.launcher-tooltip');
    if (!tooltip) return;
    const hasUserMessage = this.state?.messages.some(
      (message) => message.role === 'user' && messageText(message).length > 0,
    );
    tooltip.textContent = hasUserMessage
      ? 'Continue your conversation'
      : this.launcherTooltipDefault;
  }

  private setMaximized(value: boolean): void {
    this.maximized = value;
    this.panel.classList.toggle('is-maximized', value);
    this.maximizeButton.setAttribute('aria-pressed', String(value));
    this.maximizeButton.setAttribute('aria-label', value ? 'Restore chat size' : 'Maximize chat');
    this.artworkButton.setAttribute('aria-expanded', String(value));
    this.artworkButton.setAttribute(
      'aria-label',
      value
        ? 'Restore chat size and reduce agent flow diagram'
        : 'Maximize chat to enlarge agent flow diagram',
    );
  }

  private updateStatusFromState(state: ChatState): void {
    if (this.busy) return;
    if (this.notice) this.setStatus(this.notice);
    else if (state.contactRequest)
      this.setStatus('Enter your email address to complete the handoff.');
    else if (state.phase === 'reconnecting' && isActiveRun(state)) this.setStatus('Reconnecting…');
    else if (state.error) this.setStatus(state.error.message);
    else this.setStatus('');
  }

  private updateControls(): void {
    this.input.disabled = this.busy;
    this.sendButton.disabled = this.busy;
    this.clearButton.disabled = this.busy;
    this.mailOption.disabled =
      this.busy ||
      this.configuration?.emailHandoff !== true ||
      !this.state?.messages.some((message) => message.role === 'user');
    this.mailInput.disabled = this.busy;
    this.mailSubmit.disabled = this.busy;
    const awaitingContact = Boolean(this.state?.contactRequest);
    this.input.placeholder = awaitingContact ? 'Email address' : 'Type your message…';
  }

  private setStatus(value: string): void {
    this.status.textContent = value;
  }

  private setMailStatus(value: string): void {
    this.mailStatus.textContent = value;
  }

  private get agentName(): string {
    return this.configuration?.agentLabel ?? this.getAttribute('title') ?? 'AI agent';
  }
  private widgetStorageKey(widgetKey: string, agent: string): string {
    return `formation-chat-widget:${widgetKey}:${agent}`;
  }

  private selectSessionAvatars(widgetStorageKey: string): void {
    let selection: { agentIndex: number; userIndex: number };
    try {
      selection = selectStoredConversationAvatars(localStorage, widgetStorageKey);
    } catch {
      selection = selectStoredConversationAvatars(
        {
          getItem: () => null,
          setItem: () => undefined,
        },
        widgetStorageKey,
      );
    }
    this.agentAvatarIndex = selection.agentIndex;
    this.userAvatarIndex = selection.userIndex;
  }

  private agentProfileMarkup(className: string, override?: string, interactive = true): string {
    if (override) {
      return `<img class="${className}" src="${escapeAttribute(override)}" alt="">`;
    }
    return this.profileMarkup(className, 'agent', interactive);
  }

  private profileMarkup(className: string, role: AvatarRole, interactive: boolean): string {
    const index = role === 'agent' ? this.agentAvatarIndex : this.userAvatarIndex;
    const { column, row } = avatarCoordinates(index);
    const spriteUrl = this.profileSpriteUrl(role, index);
    const roleAttribute = role === 'agent' ? 'data-agent-avatar-index' : 'data-user-avatar-index';
    const tag = interactive ? 'button' : 'span';
    const buttonAttributes = interactive
      ? ` type="button" data-avatar-picker="${role}" aria-label="Choose ${role === 'agent' ? 'agent' : 'your'} avatar"`
      : ' aria-hidden="true"';
    return `<${tag} class="${className} profile-sprite ${role}-sprite" ${roleAttribute}="${index}" style="background-image:url(&quot;${escapeAttribute(spriteUrl)}&quot;);--avatar-column:${column};--avatar-row:${row}"${buttonAttributes}></${tag}>`;
  }

  private createAgentProfile(className: string): HTMLElement {
    const override =
      this.getAttribute('agent-image')?.trim() || this.getAttribute('launcher-image')?.trim();
    if (override) {
      const image = document.createElement('img');
      image.className = className;
      image.src = override;
      image.alt = '';
      return image;
    }
    return this.createProfile(className, 'agent');
  }

  private createProfile(className: string, role: AvatarRole): HTMLButtonElement {
    const profile = document.createElement('button');
    profile.type = 'button';
    profile.className = `${className} profile-sprite ${role}-sprite`;
    profile.dataset.avatarPicker = role;
    profile.ariaLabel = role === 'agent' ? 'Choose agent avatar' : 'Choose your avatar';
    this.applyProfileIndex(profile, role);
    return profile;
  }

  private refreshProfiles(): void {
    this.root.querySelectorAll<HTMLElement>('.profile-sprite').forEach((profile) => {
      const role: AvatarRole = profile.classList.contains('user-sprite') ? 'user' : 'agent';
      this.applyProfileIndex(profile, role);
    });
  }

  private applyProfileIndex(profile: HTMLElement, role: AvatarRole, explicitIndex?: number): void {
    const index =
      explicitIndex ?? (role === 'agent' ? this.agentAvatarIndex : this.userAvatarIndex);
    const { column, row } = avatarCoordinates(index);
    const spriteUrl = this.profileSpriteUrl(role, index);
    delete profile.dataset.agentAvatarIndex;
    delete profile.dataset.userAvatarIndex;
    profile.dataset[role === 'agent' ? 'agentAvatarIndex' : 'userAvatarIndex'] = String(index);
    profile.style.backgroundImage = `url("${spriteUrl}")`;
    profile.style.setProperty('--avatar-column', String(column));
    profile.style.setProperty('--avatar-row', String(row));
  }

  private profileSpriteUrl(role: AvatarRole, index: number): string {
    if (role === 'agent') return agentSpriteUrls[this.widgetTheme];
    return userSpriteUrls[userAvatarSheet(index).sheet];
  }

  private openAvatarPicker(role: AvatarRole): void {
    this.avatarPickerRole = role;
    this.avatarPickerReturnPage = this.currentPage === 'avatar' ? 'chat' : this.currentPage;
    this.avatarPickerHeading.textContent =
      role === 'agent' ? 'Choose an agent avatar' : 'Choose your avatar';
    this.avatarPickerDescription.textContent =
      role === 'agent'
        ? 'Select the profile this agent uses in the current conversation.'
        : 'Select the profile used beside your messages in this conversation.';
    this.avatarGallery.setAttribute(
      'aria-label',
      role === 'agent' ? 'Available agent avatars' : 'Available user avatars',
    );
    this.avatarSections.forEach((section, sectionIndex) => {
      section.hidden = role === 'agent' && sectionIndex > 0;
      const heading = section.querySelector<HTMLElement>('h3');
      if (heading && sectionIndex === 0)
        heading.textContent = role === 'agent' ? 'Agents' : 'Human';
    });
    const selected = role === 'agent' ? this.agentAvatarIndex : this.userAvatarIndex;
    const availableCount = role === 'agent' ? AGENT_AVATAR_COUNT : USER_AVATAR_COUNT;
    this.avatarGallery
      .querySelectorAll<HTMLButtonElement>('[data-avatar-choice]')
      .forEach((choice) => {
        const index = Number(choice.dataset.avatarChoice);
        choice.hidden = index >= availableCount;
        if (choice.hidden) return;
        choice.className = `avatar-choice profile-sprite ${role}-sprite`;
        choice.ariaLabel = `${role === 'agent' ? 'Agent' : 'User'} avatar ${index + 1}`;
        choice.setAttribute('aria-pressed', String(index === selected));
        this.applyProfileIndex(choice, role, index);
      });
    this.showPage('avatar');
    this.avatarGallery
      .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }

  private chooseAvatar(index: number): void {
    if (!this.avatarWidgetStorageKey) return;
    try {
      storeAvatarIndex(localStorage, this.avatarWidgetStorageKey, this.avatarPickerRole, index);
    } catch {
      return;
    }
    if (this.avatarPickerRole === 'agent') this.agentAvatarIndex = index;
    else this.userAvatarIndex = index;
    this.refreshProfiles();
    this.showPage(this.avatarPickerReturnPage);
  }
  private get launcher() {
    return requiredElement<HTMLButtonElement>(this.root, '.launcher');
  }
  private get panel() {
    return requiredElement<HTMLElement>(this.root, '.panel');
  }
  private get pages() {
    return this.root.querySelectorAll<HTMLElement>('.widget-page');
  }
  private get backButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.back');
  }
  private get menuButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.menu');
  }
  private get maximizeButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.maximize');
  }
  private get closeButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.close');
  }
  private get clearButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.clear');
  }
  private get printButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.print-option');
  }
  private get mailOption() {
    return requiredElement<HTMLButtonElement>(this.root, '.mail-option');
  }
  private get artworkButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.artwork-card');
  }
  private get avatarGallery() {
    return requiredElement<HTMLElement>(this.root, '.avatar-gallery');
  }
  private get avatarSections() {
    return this.avatarGallery.querySelectorAll<HTMLElement>('.avatar-section');
  }
  private get avatarPickerHeading() {
    return requiredElement<HTMLElement>(this.root, '[data-avatar-picker-heading]');
  }
  private get avatarPickerDescription() {
    return requiredElement<HTMLElement>(this.root, '[data-avatar-picker-description]');
  }
  private get messageForm() {
    return requiredElement<HTMLFormElement>(this.root, '.message-form');
  }
  private get mailForm() {
    return requiredElement<HTMLFormElement>(this.root, '.mail-form');
  }
  private get input() {
    return requiredElement<HTMLTextAreaElement>(this.root, 'textarea');
  }
  private get mailInput() {
    return requiredElement<HTMLInputElement>(this.root, '#conversation-email');
  }
  private get mailSubmit() {
    return requiredElement<HTMLButtonElement>(this.root, '.mail-form button[type="submit"]');
  }
  private get sendButton() {
    return requiredElement<HTMLButtonElement>(this.root, '.send');
  }
  private get emojiToggle() {
    return requiredElement<HTMLButtonElement>(this.root, '.emoji-toggle');
  }
  private get emojiBoard() {
    return requiredElement<HTMLElement>(this.root, '.emoji-board');
  }
  private get messages() {
    return requiredElement<HTMLElement>(this.root, '.messages');
  }
  private get status() {
    return requiredElement<HTMLElement>(this.root, '.status');
  }
  private get mailStatus() {
    return requiredElement<HTMLElement>(this.root, '.mail-status');
  }
  private get headerName() {
    return requiredElement<HTMLElement>(this.root, '.header-copy strong');
  }
}

function renderedMessages(
  state: ChatState | undefined,
  fallbackTimes: Map<string, string>,
): RenderedMessage[] {
  if (!state) return [];
  const messages: RenderedMessage[] = state.messages.map((message) => ({
    id: message.messageId,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: messageText(message),
    createdAt: message.createdAt,
  }));
  for (const live of Object.values(state.liveMessages)) {
    const createdAt = fallbackTimes.get(live.messageId) ?? new Date().toISOString();
    fallbackTimes.set(live.messageId, createdAt);
    messages.push({ id: live.messageId, role: 'assistant', text: live.text, createdAt });
  }
  if (state.contactRequest) {
    const id = `contact-${state.contactRequest.requestId}`;
    const createdAt = fallbackTimes.get(id) ?? new Date().toISOString();
    fallbackTimes.set(id, createdAt);
    messages.push({ id, role: 'assistant', text: state.contactRequest.prompt, createdAt });
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

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatPrintTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

function printStyles(): string {
  return `:root{font-family:Inter,system-ui,sans-serif;color:#1c211d;background:#f6f4ed}*{box-sizing:border-box}body{margin:0;padding:40px 20px}main{max-width:760px;margin:auto;background:#fff;padding:48px;border:1px solid #dedbd0}header{border-bottom:2px solid #1c211d;padding-bottom:24px}.print-title{display:flex;align-items:center;gap:14px}.print-title p{margin:0 0 6px;text-transform:uppercase;letter-spacing:.12em;font-size:11px}h1{margin:0;font-size:32px}dl{display:flex;gap:32px;margin:24px 0 0}dl div{display:grid;gap:3px}dt{font-size:10px;text-transform:uppercase;color:#687069}dd{margin:0;font-size:13px}section{display:grid;gap:20px;padding:32px 0}article{align-items:flex-start;display:flex;gap:10px;max-width:82%}article.user{flex-direction:row-reverse;margin-left:auto}.print-message{min-width:0}.print-avatar{border-radius:9px;display:block;flex:0 0 auto;height:38px;overflow:hidden;position:relative;width:38px}.print-avatar img{height:720%;image-rendering:pixelated;left:calc(-10% - var(--avatar-column) * 120%);max-width:none;position:absolute;top:calc(-10% - var(--avatar-row) * 120%);width:720%}.print-avatar.custom-avatar img{height:100%;left:0;object-fit:cover;position:absolute;top:0;width:100%}.print-title .print-avatar{height:52px;width:52px}.meta{display:flex;gap:12px;align-items:baseline;margin-bottom:5px}.meta strong{font-size:12px}.meta time{font-size:10px;color:#687069}article p{margin:0;padding:12px 14px;border-radius:12px;background:#f0eee7;line-height:1.5}article.user p{background:#1c211d;color:#fff}.empty{color:#687069}footer{border-top:1px solid #dedbd0;padding-top:18px;font-size:10px;color:#687069}@media print{body{padding:0;background:#fff}main{border:0;padding:0}}`;
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

function icon(path: string, className = ''): string {
  return `<svg${className ? ` class="${className}"` : ''} viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

function avatarGalleryMarkup(): string {
  return [
    avatarSectionMarkup('human', 'Human', 0, USER_AVATARS_PER_SHEET * 2),
    avatarSectionMarkup('animals', 'Animals', 72),
  ].join('');
}

function avatarSectionMarkup(
  section: 'human' | 'animals',
  heading: string,
  start: number,
  count = AGENT_AVATAR_COUNT,
): string {
  const choices = Array.from(
    { length: count },
    (_, offset) =>
      `<button class="avatar-choice" type="button" role="listitem" data-avatar-choice="${start + offset}" aria-label="Avatar ${start + offset + 1}"></button>`,
  ).join('');
  return `<section class="avatar-section" data-avatar-section="${section}" role="group" aria-label="${heading}"><h3>${heading}</h3><div class="avatar-grid">${choices}</div></section>`;
}

function normalizeTheme(value: string | null | undefined): WidgetTheme {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'blue' ||
    normalized === 'dark-green' ||
    normalized === 'light' ||
    normalized === 'rgb-neon'
  ) {
    return normalized;
  }
  return 'hot-pink';
}

function normalizeColorMode(value: string | null | undefined): WidgetColorMode {
  return value?.trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

function resolvePrivacyPolicyUrl(value: string | null): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, document.baseURI);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function backIcon() {
  return icon('<path d="m15 18-6-6 6-6"/>');
}
function closeIcon() {
  return icon('<path d="M5 5 19 19M19 5 5 19"/>');
}
function collapseIcon() {
  return icon('<path d="m6 9 6 6 6-6"/>');
}
function menuIcon() {
  return icon('<path d="M5 7h14M5 12h14M5 17h14"/>');
}
function maximizeIcon() {
  return icon('<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/>');
}
function restoreIcon() {
  return icon('<path d="M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5"/>');
}
function smileIcon() {
  return icon(
    '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01M9 14c1.8 1.6 4.2 1.6 6 0"/>',
  );
}
function sendIcon() {
  return icon('<path d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13"/>');
}
function chevronIcon() {
  return icon('<path d="m9 6 6 6-6 6"/>', 'chevron');
}
function printIcon() {
  return icon(
    '<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z"/>',
  );
}
function mailIcon() {
  return icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>');
}
function infoIcon() {
  return icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>');
}
function trashIcon() {
  return icon('<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>');
}
function expandIcon() {
  return icon('<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/>');
}
function lockIcon() {
  return icon(
    '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  );
}
function copyIcon() {
  return icon(
    '<rect x="8" y="8" width="10" height="10" rx="2"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  );
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
  copyDatasetAttribute(script, widget, 'colorMode', 'color-mode');
  copyDatasetAttribute(script, widget, 'launcher', 'launcher');
  copyDatasetAttribute(script, widget, 'placement', 'placement');
  copyDatasetAttribute(script, widget, 'version', 'version');
  copyDatasetAttribute(script, widget, 'launcherTooltip', 'launcher-tooltip');
  copyDatasetAttribute(script, widget, 'privacyPolicyUrl', 'privacy-policy-url');
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

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function isActiveRun(state: ChatState): boolean {
  return state.run?.status === 'queued' || state.run?.status === 'running';
}
