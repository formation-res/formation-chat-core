import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConversationService } from '../src/conversation/service.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { buildServer } from '../src/server.js';
import { SessionTokenService } from '../src/session/token.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 4 });
const secret = '0123456789abcdef0123456789abcdef';
const tokens = new SessionTokenService(secret, 600);
const conversations = new ConversationService(database);
const server = buildServer({
  checkDatabase: async () => undefined,
  conversationService: conversations,
  sessionTokens: tokens,
  logger: false,
});
let tokenA: string;
let tokenB: string;

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
  await database
    .insertInto('principals')
    .values([
      {
        principal_id: 'principal-a',
        tenant_id: 'tenant-a',
        site_id: 'site-a',
        kind: 'anonymous',
        browser_identity: 'browser-a',
      },
      {
        principal_id: 'principal-b',
        tenant_id: 'tenant-b',
        site_id: 'site-b',
        kind: 'anonymous',
        browser_identity: 'browser-b',
      },
    ])
    .execute();
  await database
    .insertInto('browser_sessions')
    .values([
      {
        session_id: 'session-a',
        tenant_id: 'tenant-a',
        site_id: 'site-a',
        principal_id: 'principal-a',
        expires_at: new Date(Date.now() + 600_000),
      },
      {
        session_id: 'session-b',
        tenant_id: 'tenant-b',
        site_id: 'site-b',
        principal_id: 'principal-b',
        expires_at: new Date(Date.now() + 600_000),
      },
    ])
    .execute();
  tokenA = (
    await tokens.issue({
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'principal-a',
      sessionId: 'session-a',
    })
  ).token;
  tokenB = (
    await tokens.issue({
      tenantId: 'tenant-b',
      siteId: 'site-b',
      principalId: 'principal-b',
      sessionId: 'session-b',
    })
  ).token;
});

beforeEach(async () => {
  await database.deleteFrom('command_idempotency').execute();
  await database.deleteFrom('messages').execute();
  await database.deleteFrom('conversation_participants').execute();
  await database.deleteFrom('conversations').execute();
});

afterAll(async () => {
  await server.close();
  await database.destroy();
});

const createConversation = (token: string, idempotencyKey = crypto.randomUUID()) =>
  server.inject({
    method: 'POST',
    url: '/v1/conversations',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
    payload: {},
  });

describe('conversation API', () => {
  it('creates a conversation from trusted token and site configuration', async () => {
    const response = await createConversation(tokenA);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      tenantId: 'tenant-a',
      siteId: 'site-a',
      principalId: 'principal-a',
      agentRef: 'agent-a',
      status: 'active',
      participants: [
        { kind: 'user', principalId: 'principal-a' },
        { kind: 'agent', agentRef: 'agent-a' },
      ],
    });
  });

  it('replays conversation creation for the same idempotency key', async () => {
    const key = crypto.randomUUID();
    const first = await createConversation(tokenA, key);
    const replay = await createConversation(tokenA, key);

    expect(replay.statusCode).toBe(201);
    expect(replay.json().conversationId).toBe(first.json().conversationId);
  });

  it('hides a conversation from a token in another tenant and site', async () => {
    const created = (await createConversation(tokenA)).json();
    const response = await server.inject({
      method: 'GET',
      url: `/v1/conversations/${created.conversationId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lists conversations with stable cursor pagination', async () => {
    await createConversation(tokenA);
    await createConversation(tokenA);
    await createConversation(tokenA);

    const first = await server.inject({
      method: 'GET',
      url: '/v1/conversations?limit=2',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const firstPage = first.json();
    const second = await server.inject({
      method: 'GET',
      url: `/v1/conversations?limit=2&cursor=${firstPage.pagination.nextCursor}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.pagination).toMatchObject({ hasMore: true });
    expect(second.json().data).toHaveLength(1);
    expect(second.json().pagination).toEqual({ hasMore: false });
  });

  it('rejects requests without a valid bearer token', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/conversations' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a malformed pagination cursor', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/conversations?cursor=bm90LWpzb24',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } });
  });
});
