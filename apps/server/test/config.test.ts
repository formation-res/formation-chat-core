import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('parses required and optional configuration', () => {
    expect(
      loadConfig({
        DATABASE_URL: 'postgres://chat:password@localhost:5432/chat_core',
        HOST: '127.0.0.1',
        PORT: '8080',
        LOG_LEVEL: 'debug',
        DB_POOL_MAX: '5',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        SESSION_TOKEN_TTL_SECONDS: '600',
      }),
    ).toEqual({
      databaseUrl: 'postgres://chat:password@localhost:5432/chat_core',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databasePoolMax: 5,
      sessionTokenSecret: '0123456789abcdef0123456789abcdef',
      sessionTokenTtlSeconds: 600,
    });
  });

  it('fails safely when required configuration is missing', () => {
    expect(() => loadConfig({})).toThrow(
      'Invalid configuration: DATABASE_URL, SESSION_TOKEN_SECRET',
    );
  });

  it('never includes configuration values in validation errors', () => {
    const secretUrl = 'postgres://chat:super-secret-password@localhost:5432/chat_core';

    expect(() =>
      loadConfig({
        DATABASE_URL: secretUrl,
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        PORT: 'not-a-port',
        LOG_LEVEL: 'verbose',
      }),
    ).toThrowError(/PORT, LOG_LEVEL/);
    try {
      loadConfig({
        DATABASE_URL: secretUrl,
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        PORT: 'not-a-port',
      });
    } catch (error) {
      expect(String(error)).not.toContain('super-secret-password');
    }
  });

  it('rejects weak token secrets and out-of-policy expiry', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: 'too-short',
        SESSION_TOKEN_TTL_SECONDS: '7200',
      }),
    ).toThrow('Invalid configuration: SESSION_TOKEN_SECRET, SESSION_TOKEN_TTL_SECONDS');
  });
});
