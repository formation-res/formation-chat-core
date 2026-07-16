import { describe, expect, it, vi } from 'vitest';

import { buildServer } from '../src/server.js';

describe('server health and correlation', () => {
  it('closes the database when the server closes', async () => {
    const closeDatabase = vi.fn(async () => undefined);
    const server = buildServer({
      checkDatabase: async () => undefined,
      closeDatabase,
      logger: false,
    });

    await server.close();

    expect(closeDatabase).toHaveBeenCalledOnce();
  });

  it('reports liveness without consulting PostgreSQL', async () => {
    let checks = 0;
    const server = buildServer({
      checkDatabase: async () => {
        checks += 1;
      },
      logger: false,
    });

    const response = await server.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(checks).toBe(0);
    await server.close();
  });

  it('reports readiness only when PostgreSQL is reachable', async () => {
    const ready = buildServer({ checkDatabase: async () => undefined, logger: false });
    const unavailable = buildServer({
      checkDatabase: async () => {
        throw new Error('postgres://user:secret@database/internal');
      },
      logger: false,
    });

    const readyResponse = await ready.inject({ method: 'GET', url: '/health/ready' });
    const unavailableResponse = await unavailable.inject({ method: 'GET', url: '/health/ready' });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual({ status: 'ready' });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.body).not.toContain('secret');
    expect(unavailableResponse.json()).toMatchObject({
      status: 'unavailable',
      error: { code: 'DATABASE_UNAVAILABLE' },
    });
    await Promise.all([ready.close(), unavailable.close()]);
  });

  it('generates correlation IDs instead of trusting caller values', async () => {
    const server = buildServer({ checkDatabase: async () => undefined, logger: false });

    const response = await server.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-correlation-id': 'caller-controlled' },
    });

    expect(response.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.headers['x-correlation-id']).not.toBe('caller-controlled');
    await server.close();
  });

  it('sets API security headers and rejects requests over the configured rate', async () => {
    const server = buildServer({
      checkDatabase: async () => undefined,
      logger: false,
      security: {
        bodyLimitBytes: 16_384,
        requestTimeoutMs: 30_000,
        trustProxy: false,
        rateLimitWindowMs: 60_000,
        publicRateLimitMax: 1,
        bootstrapRateLimitMax: 1,
        adminRateLimitMax: 1,
      },
    });

    const first = await server.inject({ method: 'GET', url: '/v1/missing' });
    const limited = await server.inject({ method: 'GET', url: '/v1/missing' });

    expect(first.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'ratelimit-limit': '1',
      'ratelimit-remaining': '0',
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(limited.body).not.toContain('127.0.0.1');
    await server.close();
  });

  it('audits API outcomes without persisting query strings, headers, or bodies', async () => {
    const record = vi.fn(async () => undefined);
    const server = buildServer({
      checkDatabase: async () => undefined,
      logger: false,
      audit: { record },
    });

    await server.inject({
      method: 'POST',
      url: '/v1/missing?email=visitor%40example.test',
      headers: { authorization: 'Bearer secret-token' },
      payload: { private: 'raw-private-value' },
    });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorKind: 'system',
        action: 'POST /v1/unmatched',
        outcome: 'success',
        statusCode: 404,
      }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/visitor|secret-token|raw-private-value/);
    await server.close();
  });

  it('exposes low-cardinality metrics only with the configured bearer credential', async () => {
    const token = 'metrics-secret-0123456789abcdef0123456789abcdef';
    const server = buildServer({
      checkDatabase: async () => undefined,
      logger: false,
      metricsBearerToken: token,
    });
    await server.inject({ method: 'GET', url: '/health/live' });

    const denied = await server.inject({ method: 'GET', url: '/metrics' });
    const allowed = await server.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(denied.statusCode).toBe(401);
    expect(denied.body).not.toContain(token);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain(
      'chat_core_http_requests_total{method="GET",status_group="2xx"}',
    );
    expect(allowed.body).not.toMatch(/token|authorization|path=/i);
    await server.close();
  });
});
