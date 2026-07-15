import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockConnector } from '@formation-chat-core/mock-connector';
import type { ChatConnector } from '@formation-chat-core/server-sdk';

import { ConversationService } from '../src/conversation/service.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { EventBroker } from '../src/event/broker.js';
import { EventService } from '../src/event/service.js';
import { EventStore } from '../src/event/store.js';
import { MessageService } from '../src/message/service.js';
import { RunCancellationCoordinator } from '../src/run/cancellation.js';
import { RunService } from '../src/run/service.js';
import { RunWorker } from '../src/run/worker.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 6 });
const conversations = new ConversationService(database);
const messages = new MessageService(database);
const events = new EventService(
  new EventStore(database, { retentionMaxEvents: 100 }),
  new EventBroker({ subscriberBufferSize: 10 }),
);
const scope = { tenantId: 'tenant-worker', siteId: 'site-worker', principalId: 'principal-worker' };

beforeAll(async () => {
  await migrateDatabase(database);
  await database.deleteFrom('conversation_events').execute();
  await database.deleteFrom('agent_runs').execute();
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
    .values({ tenant_id: scope.tenantId, display_name: 'Worker tenant' })
    .execute();
  await database
    .insertInto('sites')
    .values({
      site_id: scope.siteId,
      tenant_id: scope.tenantId,
      site_key: 'worker-site-key',
      display_name: 'Worker site',
      allowed_origins: JSON.stringify(['https://worker.example']),
      agent_ref: 'agent-worker',
    })
    .execute();
  await database
    .insertInto('principals')
    .values({
      principal_id: scope.principalId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      kind: 'anonymous',
      browser_identity: 'browser-worker',
    })
    .execute();
});

beforeEach(async () => {
  await database.deleteFrom('conversation_events').execute();
  await database.deleteFrom('agent_runs').execute();
  await database.deleteFrom('command_idempotency').execute();
  await database.deleteFrom('messages').execute();
  await database.deleteFrom('conversation_participants').execute();
  await database.deleteFrom('conversations').execute();
});

afterAll(async () => database.destroy());

const submit = async () => {
  const conversation = await conversations.create(scope, crypto.randomUUID());
  await messages.submit(
    scope,
    conversation.conversationId,
    { parts: [{ type: 'text', text: 'Run the mock connector.' }] },
    crypto.randomUUID(),
  );
  return conversation;
};

describe('RunWorker', () => {
  it('materializes one assistant message and completes a queued run', async () => {
    const conversation = await submit();
    const worker = new RunWorker(database, events, () => new MockConnector({ chunks: 2 }), {
      leaseMs: 30_000,
      maxAttempts: 3,
    });

    expect(await worker.processNext()).toBe(true);
    expect(await worker.processNext()).toBe(false);

    const run = await database.selectFrom('agent_runs').selectAll().executeTakeFirstOrThrow();
    const transcript = await messages.list(scope, conversation.conversationId, { limit: 20 });
    const storedEvents = await database
      .selectFrom('conversation_events')
      .select('type')
      .where('conversation_id', '=', conversation.conversationId)
      .orderBy('sequence')
      .execute();
    expect(run.status).toBe('completed');
    expect(run.attempt).toBe(1);
    expect(transcript.data.map(({ role, status }) => [role, status])).toEqual([
      ['user', 'completed'],
      ['assistant', 'completed'],
    ]);
    expect(storedEvents.map(({ type }) => type)).toContain('message.completed');
  });

  it('reclaims an expired run without duplicating its assistant message', async () => {
    const conversation = await submit();
    const run = await database.selectFrom('agent_runs').selectAll().executeTakeFirstOrThrow();
    const participant = await database
      .selectFrom('conversation_participants')
      .select('participant_id')
      .where('conversation_id', '=', conversation.conversationId)
      .where('kind', '=', 'agent')
      .executeTakeFirstOrThrow();
    await database
      .updateTable('conversations')
      .set({ next_message_sequence: 3 })
      .where('conversation_id', '=', conversation.conversationId)
      .execute();
    await database
      .insertInto('messages')
      .values({
        message_id: run.assistant_message_id,
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
        conversation_id: conversation.conversationId,
        sequence: 2,
        participant_id: participant.participant_id,
        role: 'assistant',
        status: 'streaming',
        parts: JSON.stringify([]),
        completed_at: null,
      })
      .execute();
    await database
      .updateTable('agent_runs')
      .set({
        status: 'running',
        attempt: 1,
        lease_expires_at: new Date(0),
      })
      .where('run_id', '=', run.run_id)
      .execute();
    const worker = new RunWorker(database, events, () => new MockConnector({ chunks: 1 }), {
      leaseMs: 30_000,
      maxAttempts: 3,
    });

    expect(await worker.processNext(new Date(Date.now() + 60_000))).toBe(true);

    const transcript = await messages.list(scope, conversation.conversationId, { limit: 20 });
    expect(transcript.data.filter(({ role }) => role === 'assistant')).toHaveLength(1);
    expect(
      (await database.selectFrom('agent_runs').select('attempt').executeTakeFirstOrThrow()).attempt,
    ).toBe(2);
  });

  it('rejects invalid connector output before it reaches the event store', async () => {
    await submit();
    const invalidConnector: ChatConnector = {
      async *run(execution) {
        yield {
          type: 'run.started',
          visibility: 'public',
          conversationId: 'wrong-conversation',
          runId: execution.request.runId,
          data: { agentRef: execution.request.agentRef },
        };
      },
    };
    const worker = new RunWorker(database, events, () => invalidConnector, {
      leaseMs: 30_000,
      maxAttempts: 3,
    });

    expect(await worker.processNext()).toBe(true);

    expect(await database.selectFrom('conversation_events').selectAll().execute()).toEqual([]);
    expect(
      await database
        .selectFrom('agent_runs')
        .select(['status', 'error_code'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'failed', error_code: 'INVALID_CONNECTOR_EVENT' });
  });

  it('records a deterministic connector failure', async () => {
    await submit();
    const worker = new RunWorker(
      database,
      events,
      () => new MockConnector({ scenario: 'failure', failureCode: 'MOCK_FAILURE' }),
      { leaseMs: 30_000, maxAttempts: 3 },
    );

    await worker.processNext();

    expect(
      await database
        .selectFrom('agent_runs')
        .select(['status', 'error_code'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'failed', error_code: 'MOCK_FAILURE' });
    expect(
      (
        await database
          .selectFrom('conversation_events')
          .select('type')
          .orderBy('sequence')
          .execute()
      ).map(({ type }) => type),
    ).toEqual(['run.started', 'run.failed']);
  });

  it('persists private connector events without publishing them in public replay', async () => {
    const conversation = await submit();
    const privateConnector: ChatConnector = {
      async *run(execution) {
        yield {
          type: 'run.started',
          visibility: 'internal',
          conversationId: execution.request.conversationId,
          runId: execution.request.runId,
          data: { agentRef: execution.request.agentRef },
        };
        yield {
          type: 'run.completed',
          visibility: 'public',
          conversationId: execution.request.conversationId,
          runId: execution.request.runId,
          data: {},
        };
      },
    };
    const worker = new RunWorker(database, events, () => privateConnector, {
      leaseMs: 30_000,
      maxAttempts: 3,
    });

    await worker.processNext();
    const replay = await events.replay(scope, conversation.conversationId);

    expect(replay.kind).toBe('events');
    if (replay.kind === 'events') {
      expect(replay.events.map(({ type }) => type)).toEqual(['run.completed']);
    }
    expect(
      await database
        .selectFrom('conversation_events')
        .select(['type', 'visibility'])
        .orderBy('sequence')
        .execute(),
    ).toEqual([
      { type: 'run.started', visibility: 'internal' },
      { type: 'run.completed', visibility: 'public' },
    ]);
  });

  it('interrupts an active connector after a best-effort cancellation request', async () => {
    const conversation = await submit();
    const coordinator = new RunCancellationCoordinator();
    let connectorCancelCalled = false;
    const blockingConnector: ChatConnector = {
      async *run(execution) {
        yield {
          type: 'run.started',
          visibility: 'public',
          conversationId: execution.request.conversationId,
          runId: execution.request.runId,
          data: { agentRef: execution.request.agentRef },
        };
        await new Promise<void>((resolve) => {
          if (execution.signal.aborted) resolve();
          else execution.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      async cancel() {
        connectorCancelCalled = true;
        return 'accepted';
      },
    };
    const worker = new RunWorker(
      database,
      events,
      () => blockingConnector,
      { leaseMs: 30_000, maxAttempts: 3 },
      coordinator,
    );
    const service = new RunService(database, coordinator);
    const processing = worker.processNext();
    await waitForRunStarted();

    const outcome = await service.cancel(scope, conversation.conversationId, crypto.randomUUID());
    await processing;

    expect(outcome.cancellationStatus).toBe('cancel_requested');
    expect(connectorCancelCalled).toBe(true);
    expect(
      (await database.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).status,
    ).toBe('cancelled');
  });
});

async function waitForRunStarted(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const event = await database
      .selectFrom('conversation_events')
      .select('event_id')
      .where('type', '=', 'run.started')
      .executeTakeFirst();
    if (event) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Run did not start.');
}
