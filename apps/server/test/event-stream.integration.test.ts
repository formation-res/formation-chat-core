import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicConversationEvent } from '@formation-chat-core/protocol';

import { ConversationService } from '../src/conversation/service.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { EventBroker } from '../src/event/broker.js';
import { EventService } from '../src/event/service.js';
import { EventStore } from '../src/event/store.js';
import { MessageService } from '../src/message/service.js';
import { buildServer } from '../src/server.js';
import { SessionTokenService } from '../src/session/token.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 6 });
const conversations = new ConversationService(database);
const tokens = new SessionTokenService('0123456789abcdef0123456789abcdef', 600);
const broker = new EventBroker({ subscriberBufferSize: 4 });
const events = new EventService(new EventStore(database, { retentionMaxEvents: 2 }), broker);
const scope = { tenantId: 'tenant-stream', siteId: 'site-stream', principalId: 'principal-stream' };
const server = buildServer({
  checkDatabase: async () => undefined,
  conversationService: conversations,
  messageService: new MessageService(database),
  sessionTokens: tokens,
  eventService: events,
  logger: false,
});
let baseUrl: string;
let token: string;

beforeAll(async () => {
  await migrateDatabase(database);
  await database.deleteFrom('conversation_events').execute();
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
    .values({ tenant_id: scope.tenantId, display_name: 'Stream tenant' })
    .execute();
  await database
    .insertInto('sites')
    .values({
      site_id: scope.siteId,
      tenant_id: scope.tenantId,
      site_key: 'stream-site-key',
      display_name: 'Stream site',
      allowed_origins: JSON.stringify(['https://stream.example']),
      agent_ref: 'agent-stream',
    })
    .execute();
  await database
    .insertInto('principals')
    .values({
      principal_id: scope.principalId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      kind: 'anonymous',
      browser_identity: 'browser-stream',
    })
    .execute();
  token = (await tokens.issue({ ...scope, sessionId: 'session-stream' })).token;
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

beforeEach(async () => {
  await database.deleteFrom('conversation_events').execute();
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

const append = (conversationId: string) =>
  events.append(scope, {
    type: 'run.started',
    visibility: 'public',
    conversationId,
    runId: crypto.randomUUID(),
    data: { agentRef: 'agent-stream' },
  });

const stream = (conversationId: string, lastEventId?: string) =>
  fetch(`${baseUrl}/v1/conversations/${conversationId}/events`, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
    },
  });

async function readEvent(response: Response): Promise<PublicConversationEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response body is missing.');
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice(6);
  if (!data) throw new Error('SSE data frame is missing.');
  return JSON.parse(data) as PublicConversationEvent;
}

describe('conversation event SSE stream', () => {
  it('resumes after Last-Event-ID without duplicating the cursor event', async () => {
    const conversation = await conversations.create(scope, crypto.randomUUID());
    const first = await append(conversation.conversationId);
    const second = await append(conversation.conversationId);

    const response = await stream(conversation.conversationId, first.eventId);
    const replayed = await readEvent(response);

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(replayed.eventId).toBe(second.eventId);
  });

  it('emits sync.required and closes for an expired cursor', async () => {
    const conversation = await conversations.create(scope, crypto.randomUUID());
    const expired = await append(conversation.conversationId);
    await append(conversation.conversationId);
    await append(conversation.conversationId);

    const response = await stream(conversation.conversationId, expired.eventId);
    const replayed = await readEvent(response);

    expect(replayed).toMatchObject({
      type: 'sync.required',
      data: { reason: 'retention_window_exceeded' },
    });
  });

  it('publishes one live event to concurrent subscribers', async () => {
    const conversation = await conversations.create(scope, crypto.randomUUID());
    const [firstResponse, secondResponse] = await Promise.all([
      stream(conversation.conversationId),
      stream(conversation.conversationId),
    ]);

    const appended = await append(conversation.conversationId);
    const [first, second] = await Promise.all([
      readEvent(firstResponse),
      readEvent(secondResponse),
    ]);

    expect(first.eventId).toBe(appended.eventId);
    expect(second.eventId).toBe(appended.eventId);
  });
});
