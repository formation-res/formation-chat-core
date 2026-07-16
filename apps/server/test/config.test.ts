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
        EVENT_RETENTION_MAX_EVENTS: '250',
        EVENT_SUBSCRIBER_BUFFER_SIZE: '32',
        CONNECTOR_MODE: 'mock',
        RUN_WORKER_POLL_INTERVAL_MS: '100',
        RUN_LEASE_MS: '45000',
        RUN_MAX_ATTEMPTS: '5',
      }),
    ).toEqual({
      databaseUrl: 'postgres://chat:password@localhost:5432/chat_core',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databasePoolMax: 5,
      sessionTokenSecret: '0123456789abcdef0123456789abcdef',
      sessionTokenTtlSeconds: 600,
      eventRetentionMaxEvents: 250,
      eventSubscriberBufferSize: 32,
      connectorMode: 'mock',
      haystackConnectors: {},
      runWorkerPollIntervalMs: 100,
      runLeaseMs: 45000,
      runMaxAttempts: 5,
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

  it('rejects invalid event retention and subscriber buffer limits', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        EVENT_RETENTION_MAX_EVENTS: '0',
        EVENT_SUBSCRIBER_BUFFER_SIZE: '1000001',
      }),
    ).toThrow('Invalid configuration: EVENT_RETENTION_MAX_EVENTS, EVENT_SUBSCRIBER_BUFFER_SIZE');
  });

  it('rejects invalid connector worker configuration', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        CONNECTOR_MODE: 'unknown',
        RUN_WORKER_POLL_INTERVAL_MS: '0',
        RUN_LEASE_MS: '999',
        RUN_MAX_ATTEMPTS: '0',
      }),
    ).toThrow(
      'Invalid configuration: CONNECTOR_MODE, RUN_WORKER_POLL_INTERVAL_MS, RUN_LEASE_MS, RUN_MAX_ATTEMPTS',
    );
  });

  it('parses trusted Haystack bindings by agent reference', () => {
    expect(
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        CONNECTOR_MODE: 'haystack',
        HAYSTACK_CONNECTORS: JSON.stringify({
          'public-support': {
            baseUrl: 'http://haystack:8080',
            tenantKey: 'formationxyz_com',
            agentSlug: 'support',
            responseMode: 'info_chat',
            timeoutMs: 45000,
          },
        }),
      }),
    ).toMatchObject({
      connectorMode: 'haystack',
      haystackConnectors: {
        'public-support': {
          baseUrl: 'http://haystack:8080',
          tenantKey: 'formationxyz_com',
          agentSlug: 'support',
          responseMode: 'info_chat',
          timeoutMs: 45000,
        },
      },
    });
  });

  it('requires valid Haystack bindings without exposing their values', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        CONNECTOR_MODE: 'haystack',
        HAYSTACK_CONNECTORS: '{"public-support":{"baseUrl":"not-a-url"}}',
      }),
    ).toThrow('Invalid configuration: HAYSTACK_CONNECTORS');
  });
});
