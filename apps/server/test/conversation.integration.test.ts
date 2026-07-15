import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConversationService } from '../src/conversation/service.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { MessageService } from '../src/message/service.js';
import { buildServer } from '../src/server.js';
import { SessionTokenService } from '../src/session/token.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 4 });
const secret = '0123456789abcdef0123456789abcdef';
const tokens = new SessionTokenService(secret, 600);
const conversations = new ConversationService(database);
const messages = new MessageService(database);
const server = buildServer({
  checkDatabase: async () => undefined,
  conversationService: conversations,
  messageService: messages,
  sessionTokens: tokens,
  logger: false,
});
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  await migrateDatabase(database);
  await database.deleteFrom('command_idempotency').execute();
  await database.deleteFrom('agent_runs').execute();
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
  await database.deleteFrom('agent_runs').execute();
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

const submitMessage = (
  token: string,
  conversationId: string,
  text: string,
  idempotencyKey = crypto.randomUUID(),
) =>
  server.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
    payload: { parts: [{ type: 'text', text }] },
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

describe('message API', () => {
  it('accepts a completed user message attributed to the conversation participant', async () => {
    const conversation = (await createConversation(tokenA)).json();
    const response = await submitMessage(tokenA, conversation.conversationId, 'Hello');

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      conversationId: conversation.conversationId,
      sequence: 1,
      participantId: conversation.participants[0].participantId,
      role: 'user',
      status: 'completed',
      parts: [{ type: 'text', text: 'Hello' }],
    });
    expect(response.json().completedAt).toMatch(/Z$/);
  });

  it('returns the original message for a retry and rejects changed payload reuse', async () => {
    const conversation = (await createConversation(tokenA)).json();
    const key = crypto.randomUUID();
    const first = await submitMessage(tokenA, conversation.conversationId, 'First', key);
    const replay = await submitMessage(tokenA, conversation.conversationId, 'First', key);
    const conflict = await submitMessage(tokenA, conversation.conversationId, 'Changed', key);

    expect(replay.statusCode).toBe(202);
    expect(replay.json().messageId).toBe(first.json().messageId);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    const rows = await database
      .selectFrom('messages')
      .select('message_id')
      .where('conversation_id', '=', conversation.conversationId)
      .execute();
    expect(rows).toHaveLength(1);
    const runs = await database
      .selectFrom('agent_runs')
      .select(['trigger_message_id', 'status'])
      .where('conversation_id', '=', conversation.conversationId)
      .execute();
    expect(runs).toEqual([{ trigger_message_id: first.json().messageId, status: 'queued' }]);
  });

  it('allocates unique contiguous order under concurrent submissions', async () => {
    const conversation = (await createConversation(tokenA)).json();
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        submitMessage(tokenA, conversation.conversationId, `Message ${index}`),
      ),
    );
    const sequences = responses.map((response) => response.json().sequence).sort((a, b) => a - b);

    expect(responses.every((response) => response.statusCode === 202)).toBe(true);
    expect(sequences).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it('lists messages in sequence order with cursor pagination', async () => {
    const conversation = (await createConversation(tokenA)).json();
    await submitMessage(tokenA, conversation.conversationId, 'One');
    await submitMessage(tokenA, conversation.conversationId, 'Two');
    await submitMessage(tokenA, conversation.conversationId, 'Three');

    const first = await server.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.conversationId}/messages?limit=2`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const page = first.json();
    const second = await server.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.conversationId}/messages?limit=2&cursor=${page.pagination.nextCursor}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(page.data.map((message: { sequence: number }) => message.sequence)).toEqual([1, 2]);
    expect(page.pagination).toMatchObject({ hasMore: true });
    expect(second.json().data.map((message: { sequence: number }) => message.sequence)).toEqual([
      3,
    ]);
    expect(second.json().pagination).toEqual({ hasMore: false });
  });

  it('hides message endpoints from another tenant and site', async () => {
    const conversation = (await createConversation(tokenA)).json();
    expect((await submitMessage(tokenB, conversation.conversationId, 'Blocked')).statusCode).toBe(
      404,
    );
    const list = await server.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.conversationId}/messages`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(list.statusCode).toBe(404);
  });

  it('rejects a malformed message cursor', async () => {
    const conversation = (await createConversation(tokenA)).json();
    const response = await server.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.conversationId}/messages?cursor=bm90LWEtc2VxdWVuY2U`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } });
  });
});
