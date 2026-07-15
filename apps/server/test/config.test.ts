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
      }),
    ).toEqual({
      databaseUrl: 'postgres://chat:password@localhost:5432/chat_core',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databasePoolMax: 5,
    });
  });

  it('fails safely when required configuration is missing', () => {
    expect(() => loadConfig({})).toThrow('Invalid configuration: DATABASE_URL');
  });

  it('never includes configuration values in validation errors', () => {
    const secretUrl = 'postgres://chat:super-secret-password@localhost:5432/chat_core';

    expect(() =>
      loadConfig({ DATABASE_URL: secretUrl, PORT: 'not-a-port', LOG_LEVEL: 'verbose' }),
    ).toThrowError(/PORT, LOG_LEVEL/);
    try {
      loadConfig({ DATABASE_URL: secretUrl, PORT: 'not-a-port' });
    } catch (error) {
      expect(String(error)).not.toContain('super-secret-password');
    }
  });
});
