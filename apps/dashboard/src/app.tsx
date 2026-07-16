import { useEffect, useMemo, useState } from 'react';

import { AdminClient, type AdminApi } from './admin-client.js';
import { Dashboard } from './dashboard.js';
import { Icon } from './icons.js';

export interface AppProps {
  createClient?: (baseUrl: string, token: string) => AdminApi;
  initialClient?: AdminApi;
}

export function App({
  createClient = (baseUrl, token) => new AdminClient(baseUrl, token),
  initialClient,
}: AppProps) {
  const [api, setApi] = useState<AdminApi | undefined>(initialClient);
  const [theme, setTheme] = useTheme();
  if (!api)
    return (
      <ConnectionScreen
        onConnect={(baseUrl, token) => setApi(createClient(baseUrl, token))}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
    );
  return (
    <Dashboard
      api={api}
      theme={theme}
      onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      onDisconnect={() => setApi(undefined)}
    />
  );
}

function ConnectionScreen({
  onConnect,
  theme,
  onToggleTheme,
}: {
  onConnect(baseUrl: string, token: string): void;
  theme: 'light' | 'dark';
  onToggleTheme(): void;
}) {
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      onConnect(baseUrl.trim(), token.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Check the connection settings.');
    }
  };
  return (
    <main className="connection-page">
      <button
        className="icon-button connection-theme"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        onClick={onToggleTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <section className="connection-panel">
        <span className="connection-logo">
          <Icon name="activity" />
        </span>
        <p className="eyebrow">Formation Chat Core</p>
        <h1>Connect to Chat Core</h1>
        <p className="connection-intro">
          Inspect conversations and agent operations through the scoped, read-only admin API.
        </p>
        <form onSubmit={submit}>
          <label>
            Chat Core URL
            <input
              name="baseUrl"
              type="url"
              required
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              autoComplete="url"
            />
          </label>
          <label>
            Admin token
            <input
              name="token"
              type="password"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="security-note">
            The token stays in memory and is cleared when you disconnect or close this tab.
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button-primary"
            type="submit"
            disabled={!baseUrl.trim() || !token.trim()}
          >
            Open dashboard <Icon name="chevron" />
          </button>
        </form>
      </section>
    </main>
  );
}

function useTheme(): ['light' | 'dark', (theme: 'light' | 'dark') => void] {
  const preferred = useMemo<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('chat-core-dashboard-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, []);
  const [theme, setTheme] = useState(preferred);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('chat-core-dashboard-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}
