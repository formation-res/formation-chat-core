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
});
