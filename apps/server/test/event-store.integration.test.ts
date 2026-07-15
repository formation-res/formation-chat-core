import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConversationService } from '../src/conversation/service.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { EventApiError, EventStore } from '../src/event/store.js';
import { MessageService } from '../src/message/service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 12 });
const conversations = new ConversationService(database);
const messages = new MessageService(database);
const scope = { tenantId: 'tenant-events', siteId: 'site-events', principalId: 'principal-events' };

beforeAll(async () => {
  await migrateDatabase(database);
  await database.deleteFrom('conversation_events').execute();
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
    .values({ tenant_id: scope.tenantId, display_name: 'Events tenant' })
    .execute();
  await database
    .insertInto('sites')
    .values({
      site_id: scope.siteId,
      tenant_id: scope.tenantId,
      site_key: 'events-site-key',
      display_name: 'Events site',
      allowed_origins: JSON.stringify(['https://events.example']),
      agent_ref: 'agent-events',
    })
    .execute();
  await database
    .insertInto('principals')
    .values({
      principal_id: scope.principalId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      kind: 'anonymous',
      browser_identity: 'browser-events',
    })
    .execute();
});

beforeEach(async () => {
  await database.deleteFrom('conversation_events').execute();
  await database.deleteFrom('command_idempotency').execute();
  await database.deleteFrom('messages').execute();
  await database.deleteFrom('conversation_participants').execute();
  await database.deleteFrom('conversations').execute();
});

afterAll(async () => database.destroy());

const createConversation = () => conversations.create(scope, crypto.randomUUID());
const event = (conversationId: string, visibility: 'public' | 'operator' | 'internal' = 'public') =>
  ({
    type: 'run.started' as const,
    visibility,
    conversationId,
    runId: crypto.randomUUID(),
    data: { agentRef: 'agent-events' },
  }) as const;

describe('ordered conversation event store', () => {
  it('assigns gap-free increasing sequence numbers under concurrent writes', async () => {
    const conversation = await createConversation();
    const store = new EventStore(database, { retentionMaxEvents: 100 });

    const appended = await Promise.all(
      Array.from({ length: 12 }, () => store.append(scope, event(conversation.conversationId))),
    );

    expect(appended.map(({ sequence }) => sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  it('replays public events after a cursor without duplicating it', async () => {
    const conversation = await createConversation();
    const store = new EventStore(database, { retentionMaxEvents: 100 });
    const first = await store.append(scope, event(conversation.conversationId));
    await store.append(scope, event(conversation.conversationId, 'operator'));
    const third = await store.append(scope, event(conversation.conversationId));

    const replay = await store.replay(scope, conversation.conversationId, first.eventId);

    expect(replay).toEqual({ kind: 'events', events: [third] });
  });

  it('returns sync.required when the cursor is outside retention', async () => {
    const conversation = await createConversation();
    const store = new EventStore(database, { retentionMaxEvents: 2 });
    const expired = await store.append(scope, event(conversation.conversationId));
    await store.append(scope, event(conversation.conversationId));
    await store.append(scope, event(conversation.conversationId));

    const replay = await store.replay(scope, conversation.conversationId, expired.eventId);

    expect(replay.kind).toBe('sync-required');
    if (replay.kind === 'sync-required') {
      expect(replay.event).toMatchObject({
        type: 'sync.required',
        visibility: 'public',
        conversationId: conversation.conversationId,
        data: { reason: 'retention_window_exceeded' },
      });
    }
  });

  it('retains canonical completed messages after transient events are pruned', async () => {
    const conversation = await createConversation();
    const message = await messages.submit(
      scope,
      conversation.conversationId,
      { parts: [{ type: 'text', text: 'Keep this message.' }] },
      crypto.randomUUID(),
    );
    const store = new EventStore(database, { retentionMaxEvents: 2 });
    await store.append(scope, event(conversation.conversationId));
    await store.append(scope, event(conversation.conversationId));
    await store.append(scope, event(conversation.conversationId));

    const snapshot = await messages.list(scope, conversation.conversationId, { limit: 20 });
    const retainedEvents = await database
      .selectFrom('conversation_events')
      .select('event_id')
      .where('conversation_id', '=', conversation.conversationId)
      .execute();

    expect(snapshot.data).toEqual([message]);
    expect(retainedEvents).toHaveLength(2);
  });

  it("does not reveal another principal's conversation", async () => {
    const conversation = await createConversation();
    const store = new EventStore(database, { retentionMaxEvents: 100 });

    await expect(
      store.replay({ ...scope, principalId: 'someone-else' }, conversation.conversationId),
    ).rejects.toEqual(
      expect.objectContaining<Partial<EventApiError>>({
        code: 'CONVERSATION_NOT_FOUND',
        statusCode: 404,
      }),
    );
  });
});
