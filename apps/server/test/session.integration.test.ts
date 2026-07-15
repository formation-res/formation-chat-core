import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { buildServer } from '../src/server.js';
import { SessionService } from '../src/session/service.js';
import { SessionTokenService } from '../src/session/token.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 2 });
const secret = '0123456789abcdef0123456789abcdef';
const sessions = new SessionService(database, secret, 600);
const server = buildServer({
  checkDatabase: async () => undefined,
  bootstrapAnonymous: async (request, context) => sessions.bootstrapAnonymous(request, context),
  logger: false,
});

beforeAll(async () => {
  await migrateDatabase(database);
  await database.deleteFrom('command_idempotency').execute();
  await database.deleteFrom('messages').execute();
  await database.deleteFrom('conversation_participants').execute();
  await database.deleteFrom('conversations').execute();
  await database.deleteFrom('session_bootstrap_idempotency').execute();
  await database.deleteFrom('browser_sessions').execute();
  await database.deleteFrom('principals').execute();
  await database.deleteFrom('sites').execute();
  await database.deleteFrom('tenants').execute();
  await database
    .insertInto('tenants')
    .values([
      { tenant_id: 'tenant-a', display_name: 'Tenant A' },
      { tenant_id: 'tenant-b', display_name: 'Tenant B' },
    ])
    .execute();
  await database
    .insertInto('sites')
    .values([
      {
        site_id: 'site-a',
        tenant_id: 'tenant-a',
        site_key: 'site-key-a',
        display_name: 'Site A',
        allowed_origins: JSON.stringify(['https://a.example']),
        agent_ref: 'agent-a',
      },
      {
        site_id: 'site-b',
        tenant_id: 'tenant-b',
        site_key: 'site-key-b',
        display_name: 'Site B',
        allowed_origins: JSON.stringify(['https://b.example']),
        agent_ref: 'agent-b',
      },
    ])
    .execute();
});

afterAll(async () => {
  await server.close();
  await database.destroy();
});

const bootstrap = (body: Record<string, string>, origin = 'https://a.example') =>
  server.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    payload: body,
  });

describe('POST /v1/sessions', () => {
  it('creates and resumes an anonymous principal without creating a conversation', async () => {
    const created = await bootstrap({ siteKey: 'site-key-a' });
    expect(created.statusCode).toBe(200);
    const first = created.json();
    const resumed = await bootstrap({
      siteKey: 'site-key-a',
      browserIdentity: first.browserIdentity,
    });
    const second = resumed.json();

    expect(second.principal.principalId).toBe(first.principal.principalId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.accessToken).not.toContain(secret);
    const expiresIn = Date.parse(second.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(590_000);
    expect(expiresIn).toBeLessThanOrEqual(600_000);
    const principalCount = await database
      .selectFrom('principals')
      .select((expression) => expression.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(principalCount.count)).toBe(1);
  });

  it('creates a different principal for a new browser identity', async () => {
    const first = (
      await bootstrap({ siteKey: 'site-key-a', browserIdentity: 'browser-one' })
    ).json();
    const second = (
      await bootstrap({ siteKey: 'site-key-a', browserIdentity: 'browser-two' })
    ).json();
    expect(second.principal.principalId).not.toBe(first.principal.principalId);
  });

  it('rejects an unknown site and a wrong origin', async () => {
    expect((await bootstrap({ siteKey: 'missing' })).statusCode).toBe(404);
    expect((await bootstrap({ siteKey: 'site-key-a' }, 'https://evil.example')).statusCode).toBe(
      403,
    );
  });

  it('requires an idempotency key for the retryable write', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { origin: 'https://a.example' },
      payload: { siteKey: 'site-key-a' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('replays resource identity and rejects key reuse with a different payload', async () => {
    const idempotencyKey = crypto.randomUUID();
    const send = (payload: Record<string, string>) =>
      server.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { origin: 'https://a.example', 'idempotency-key': idempotencyKey },
        payload,
      });
    const first = (await send({ siteKey: 'site-key-a' })).json();
    const replay = (await send({ siteKey: 'site-key-a' })).json();
    const conflict = await send({ siteKey: 'site-key-a', browserIdentity: 'different-browser' });

    expect(replay.browserIdentity).toBe(first.browserIdentity);
    expect(replay.principal.principalId).toBe(first.principal.principalId);
    expect(replay.sessionId).toBe(first.sessionId);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('issues tokens that cannot cross site boundaries or survive tampering', async () => {
    const response = (await bootstrap({ siteKey: 'site-key-a' })).json();
    const tokens = new SessionTokenService(secret, 600);
    await expect(
      tokens.verify(response.accessToken, { tenantId: 'tenant-a', siteId: 'site-b' }),
    ).rejects.toThrow();
    const [header, payload, signature] = response.accessToken.split('.') as [string, string, string];
    const tampered = `${header}.${payload}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;
    await expect(tokens.verify(tampered)).rejects.toThrow();
  });
});
