import { useEffect, useMemo, useState } from 'react';

import { AdminClient, type AdminApi } from './admin-client.js';
import { DashboardAuthClient, type AdminSession, type DashboardAuthApi } from './auth-client.js';
import { Dashboard } from './dashboard.js';
import { Icon } from './icons.js';

export interface AppProps {
  createClient?: () => AdminApi;
  auth?: DashboardAuthApi;
  initialClient?: AdminApi;
  initialSession?: AdminSession;
}

const defaultAuth = new DashboardAuthClient();
const createDefaultClient = () => new AdminClient(window.location.origin);

export function App({
  createClient = createDefaultClient,
  auth = defaultAuth,
  initialClient,
  initialSession,
}: AppProps) {
  const [session, setSession] = useState<AdminSession | undefined>(initialSession);
  const [checking, setChecking] = useState(!initialClient && !initialSession);
  const [api, setApi] = useState<AdminApi | undefined>(initialClient);
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    if (!checking) return;
    void auth
      .getSession()
      .then((next) => {
        setSession(next);
        if (next) setApi(createClient());
      })
      .catch(() => setSession(undefined))
      .finally(() => setChecking(false));
  }, [auth, checking, createClient]);
  if (checking)
    return (
      <LoginScreen
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        checking
      />
    );
  if (!api || !session)
    return (
      <LoginScreen
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
    );
  return (
    <Dashboard
      api={api}
      session={session}
      theme={theme}
      onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      onDisconnect={() => {
        void auth.logout().finally(() => {
          setApi(undefined);
          setSession(undefined);
        });
      }}
    />
  );
}

function LoginScreen({
  theme,
  onToggleTheme,
  checking = false,
}: {
  theme: 'light' | 'dark';
  onToggleTheme(): void;
  checking?: boolean;
}) {
  const error = new URLSearchParams(window.location.search).get('authError');
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
        <h1>{checking ? 'Checking your session' : 'Sign in to Chat Core'}</h1>
        <p className="connection-intro">
          Inspect conversations and agent operations for every configured site.
        </p>
        {checking ? (
          <p className="security-note" role="status">
            Please wait…
          </p>
        ) : (
          <>
            {error ? (
              <p className="form-error" role="alert">
                {error === 'access_denied'
                  ? 'This Formation account does not have dashboard access.'
                  : 'Sign-in could not be completed. Please try again.'}
              </p>
            ) : null}
            <a className="button button-primary connection-login" href="/auth/login">
              Sign in with Formation <Icon name="chevron" />
            </a>
            <p className="security-note">Your session is stored in a secure HTTP-only cookie.</p>
          </>
        )}
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
