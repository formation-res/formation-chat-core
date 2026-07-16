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
        SESSION_TOKEN_PREVIOUS_SECRETS: '["previous-session-secret-0123456789abcdef0123456789"]',
        ADMIN_TOKEN_SECRET: 'admin-secret-0123456789abcdef0123456789abcdef',
        ADMIN_TOKEN_TTL_SECONDS: '1200',
        ADMIN_TOKEN_PREVIOUS_SECRETS: '["previous-admin-secret-0123456789abcdef0123456789"]',
        EVENT_RETENTION_MAX_EVENTS: '250',
        EVENT_SUBSCRIBER_BUFFER_SIZE: '32',
        CONNECTOR_MODE: 'mock',
        RUN_WORKER_POLL_INTERVAL_MS: '100',
        RUN_LEASE_MS: '45000',
        RUN_MAX_ATTEMPTS: '5',
        HTTP_BODY_LIMIT_BYTES: '131072',
        REQUEST_TIMEOUT_MS: '30000',
        TRUST_PROXY: 'true',
        RATE_LIMIT_WINDOW_MS: '10000',
        PUBLIC_RATE_LIMIT_MAX: '80',
        BOOTSTRAP_RATE_LIMIT_MAX: '20',
        ADMIN_RATE_LIMIT_MAX: '200',
        ANONYMOUS_RETENTION_DAYS: '14',
        AUTHENTICATED_RETENTION_DAYS: '180',
        CONTACT_VALUE_RETENTION_HOURS: '12',
        RETENTION_SWEEP_INTERVAL_MS: '60000',
        METRICS_BEARER_TOKEN: 'metrics-secret-0123456789abcdef0123456789abcdef',
      }),
    ).toEqual({
      databaseUrl: 'postgres://chat:password@localhost:5432/chat_core',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databasePoolMax: 5,
      sessionTokenSecret: '0123456789abcdef0123456789abcdef',
      sessionTokenPreviousSecrets: ['previous-session-secret-0123456789abcdef0123456789'],
      sessionTokenTtlSeconds: 600,
      admin: {
        tokenSecret: 'admin-secret-0123456789abcdef0123456789abcdef',
        previousTokenSecrets: ['previous-admin-secret-0123456789abcdef0123456789'],
        tokenTtlSeconds: 1200,
      },
      eventRetentionMaxEvents: 250,
      eventSubscriberBufferSize: 32,
      connectorMode: 'mock',
      haystackConnectors: {},
      runWorkerPollIntervalMs: 100,
      runLeaseMs: 45000,
      runMaxAttempts: 5,
      bodyLimitBytes: 131072,
      requestTimeoutMs: 30000,
      trustProxy: true,
      rateLimitWindowMs: 10000,
      publicRateLimitMax: 80,
      bootstrapRateLimitMax: 20,
      adminRateLimitMax: 200,
      anonymousRetentionDays: 14,
      authenticatedRetentionDays: 180,
      contactValueRetentionHours: 12,
      retentionSweepIntervalMs: 60000,
      metricsBearerToken: 'metrics-secret-0123456789abcdef0123456789abcdef',
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

  it('rejects malformed or duplicated secret rotation key rings', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        SESSION_TOKEN_PREVIOUS_SECRETS: '["short"]',
      }),
    ).toThrow('Invalid configuration: SESSION_TOKEN_PREVIOUS_SECRETS');
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        SESSION_TOKEN_PREVIOUS_SECRETS: '["0123456789abcdef0123456789abcdef"]',
      }),
    ).toThrow('Invalid configuration: SESSION_TOKEN_PREVIOUS_SECRETS');
  });

  it('keeps admin APIs disabled unless a strong separate secret is configured', () => {
    expect(
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
      }).admin,
    ).toBeUndefined();
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        ADMIN_TOKEN_SECRET: 'too-short',
        ADMIN_TOKEN_TTL_SECONDS: '30',
      }),
    ).toThrow('Invalid configuration: ADMIN_TOKEN_SECRET, ADMIN_TOKEN_TTL_SECONDS');
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

  it('rejects invalid HTTP and rate limit configuration', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        HTTP_BODY_LIMIT_BYTES: '100',
        REQUEST_TIMEOUT_MS: '999',
        TRUST_PROXY: 'sometimes',
        RATE_LIMIT_WINDOW_MS: '999',
        PUBLIC_RATE_LIMIT_MAX: '0',
        BOOTSTRAP_RATE_LIMIT_MAX: '0',
        ADMIN_RATE_LIMIT_MAX: '100001',
      }),
    ).toThrow(
      'Invalid configuration: HTTP_BODY_LIMIT_BYTES, REQUEST_TIMEOUT_MS, TRUST_PROXY, RATE_LIMIT_WINDOW_MS, PUBLIC_RATE_LIMIT_MAX, BOOTSTRAP_RATE_LIMIT_MAX, ADMIN_RATE_LIMIT_MAX',
    );
  });

  it('rejects invalid privacy retention configuration', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        ANONYMOUS_RETENTION_DAYS: '0',
        AUTHENTICATED_RETENTION_DAYS: '3651',
        CONTACT_VALUE_RETENTION_HOURS: '0',
        RETENTION_SWEEP_INTERVAL_MS: '59999',
      }),
    ).toThrow(
      'Invalid configuration: ANONYMOUS_RETENTION_DAYS, AUTHENTICATED_RETENTION_DAYS, CONTACT_VALUE_RETENTION_HOURS, RETENTION_SWEEP_INTERVAL_MS',
    );
  });

  it('rejects a weak metrics credential', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/chat',
        SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        METRICS_BEARER_TOKEN: 'short',
      }),
    ).toThrow('Invalid configuration: METRICS_BEARER_TOKEN');
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
