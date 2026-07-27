export interface AdminSession {
  authenticated: true;
  email: string;
  displayName: string;
  role: string;
}

export interface DashboardAuthApi {
  getSession(): Promise<AdminSession | undefined>;
  logout(): Promise<void>;
}

export class DashboardAuthClient implements DashboardAuthApi {
  async getSession(): Promise<AdminSession | undefined> {
    const response = await fetch('/auth/session', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (response.status === 401) return undefined;
    if (!response.ok) throw new Error('Authentication is unavailable.');
    const value: unknown = await response.json();
    if (!isSession(value)) throw new Error('Authentication returned an invalid response.');
    return value;
  }

  async logout(): Promise<void> {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok && response.status !== 401) throw new Error('Sign out failed.');
  }
}

function isSession(value: unknown): value is AdminSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).authenticated === true &&
    typeof (value as Record<string, unknown>).email === 'string' &&
    typeof (value as Record<string, unknown>).displayName === 'string' &&
    typeof (value as Record<string, unknown>).role === 'string'
  );
}
