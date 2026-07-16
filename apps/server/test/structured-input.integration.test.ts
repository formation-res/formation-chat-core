import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ChatConnector } from '@formation-chat-core/server-sdk';

import { ConversationService } from '../src/conversation/service.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { EventBroker } from '../src/event/broker.js';
import { EventService } from '../src/event/service.js';
import { EventStore } from '../src/event/store.js';
import { MessageService } from '../src/message/service.js';
import { RunWorker } from '../src/run/worker.js';
import { buildServer } from '../src/server.js';
import { SessionTokenService } from '../src/session/token.js';
import { StructuredInputService } from '../src/structured-input/service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 4 });
const conversations = new ConversationService(database);
const messages = new MessageService(database);
const inputs = new StructuredInputService(database);
const events = new EventService(
  new EventStore(database, { retentionMaxEvents: 100 }),
  new EventBroker({ subscriberBufferSize: 10 }),
);
const tokens = new SessionTokenService('0123456789abcdef0123456789abcdef', 600);
const scope = { tenantId: 'tenant-input', siteId: 'site-input', principalId: 'principal-input' };
const server = buildServer({
  checkDatabase: async () => undefined,
  conversationService: conversations,
  messageService: messages,
  structuredInputService: inputs,
  sessionTokens: tokens,
  logger: false,
});
let accessToken: string;

beforeAll(async () => {
  await migrateDatabase(database);
  await database.deleteFrom('structured_input_requests').execute();
  await database.deleteFrom('handoffs').execute();
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
    .values({ tenant_id: scope.tenantId, display_name: 'Input tenant' })
    .execute();
  await database
    .insertInto('sites')
    .values({
      site_id: scope.siteId,
      tenant_id: scope.tenantId,
      site_key: 'input-site',
      display_name: 'Input site',
      allowed_origins: JSON.stringify(['https://input.example']),
      agent_ref: 'support',
    })
    .execute();
  await database
    .insertInto('principals')
    .values({
      principal_id: scope.principalId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      kind: 'anonymous',
      browser_identity: 'browser-input',
    })
    .execute();
  await database
    .insertInto('browser_sessions')
    .values({
      session_id: 'session-input',
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      principal_id: scope.principalId,
      expires_at: new Date(Date.now() + 600_000),
    })
    .execute();
  accessToken = (await tokens.issue({ ...scope, sessionId: 'session-input' })).token;
});

beforeEach(async () => {
  await database.deleteFrom('structured_input_requests').execute();
  await database.deleteFrom('handoffs').execute();
  await database.deleteFrom('conversation_events').execute();
  await database.deleteFrom('agent_runs').execute();
  await database.deleteFrom('command_idempotency').execute();
  await database.deleteFrom('messages').execute();
  await database.deleteFrom('conversation_participants').execute();
  await database.deleteFrom('conversations').execute();
});

afterAll(async () => {
  await server.close();
  await database.destroy();
});

describe('structured contact lifecycle', () => {
  it('records purpose-bound consent and resumes the paused run with private input', async () => {
    const { conversationId } = await createConversationAndMessage();
    let invocation = 0;
    let resumedExecution: Parameters<ChatConnector['run']>[0] | undefined;
    const connector: ChatConnector = {
      async *run(execution) {
        if (invocation++ === 0) {
          yield* handoffRequestEvents(execution);
          return;
        }
        resumedExecution = execution;
        yield {
          type: 'handoff.completed',
          visibility: 'public',
          conversationId: execution.request.conversationId,
          runId: execution.request.runId,
          data: { handoffId: execution.request.runId, status: 'completed' },
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
    const worker = new RunWorker(database, events, () => connector, {
      leaseMs: 30_000,
      maxAttempts: 3,
    });

    await worker.processNext();
    const pending = await database
      .selectFrom('structured_input_requests')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(pending.status).toBe('pending');
    expect(
      (await database.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).status,
    ).toBe('waiting_for_input');

    const key = crypto.randomUUID();
    const submitted = await submitInput(
      conversationId,
      pending.request_id,
      {
        value: 'visitor@example.com',
        consent: true,
      },
      key,
    );
    const replay = await submitInput(
      conversationId,
      pending.request_id,
      {
        value: 'visitor@example.com',
        consent: true,
      },
      key,
    );

    expect(submitted.statusCode).toBe(200);
    expect(replay.json()).toEqual(submitted.json());
    expect(submitted.json()).toMatchObject({
      requestId: pending.request_id,
      purpose: 'handoff_email_delivery',
      status: 'submitted',
    });
    expect(JSON.stringify(submitted.json())).not.toContain('visitor@example.com');

    await worker.processNext();

    expect(resumedExecution?.request.resolvedInputs).toEqual([
      expect.objectContaining({
        requestId: pending.request_id,
        purpose: 'handoff_email_delivery',
        status: 'submitted',
        value: 'visitor@example.com',
        consent: expect.objectContaining({ status: 'granted' }),
      }),
    ]);
    expect(resumedExecution?.request.history.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(
      await database.selectFrom('handoffs').select('status').executeTakeFirstOrThrow(),
    ).toEqual({ status: 'completed' });
  });

  it('rejects invalid email and changed idempotent input without exposing stored contact', async () => {
    const { conversationId, requestId } = await createPausedHandoff();
    const invalid = await submitInput(conversationId, requestId, {
      value: 'not-an-email',
      consent: true,
    });
    const key = crypto.randomUUID();
    await submitInput(
      conversationId,
      requestId,
      {
        value: 'first@example.com',
        consent: true,
      },
      key,
    );
    const conflict = await submitInput(
      conversationId,
      requestId,
      {
        value: 'changed@example.com',
        consent: true,
      },
      key,
    );

    expect(invalid.statusCode).toBe(400);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(JSON.stringify(conflict.json())).not.toContain('first@example.com');
  });

  it('does not resolve input through a token for another principal', async () => {
    const { conversationId, requestId } = await createPausedHandoff();
    const otherToken = (
      await tokens.issue({ ...scope, principalId: 'principal-other', sessionId: 'session-other' })
    ).token;

    const response = await server.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/inputs/${requestId}`,
      headers: {
        authorization: `Bearer ${otherToken}`,
        'idempotency-key': crypto.randomUUID(),
      },
      payload: { value: 'visitor@example.com', consent: true },
    });

    expect(response.statusCode).toBe(404);
    expect(
      await database
        .selectFrom('structured_input_requests')
        .select(['status', 'value'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'pending', value: null });
  });

  it('records a declined decision and resumes without an email value', async () => {
    const { conversationId, requestId } = await createPausedHandoff();

    const response = await submitInput(conversationId, requestId, { declined: true });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('declined');
    expect(
      await database
        .selectFrom('structured_input_requests')
        .select(['value', 'consent_status'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ value: null, consent_status: 'declined' });
    expect(
      (await database.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).status,
    ).toBe('queued');
  });
});

async function createConversationAndMessage(): Promise<{ conversationId: string }> {
  const conversation = await conversations.create(scope, crypto.randomUUID());
  await messages.submit(
    scope,
    conversation.conversationId,
    { parts: [{ type: 'text', text: 'Please ask a person to follow up.' }] },
    crypto.randomUUID(),
  );
  return { conversationId: conversation.conversationId };
}

async function createPausedHandoff(): Promise<{ conversationId: string; requestId: string }> {
  const { conversationId } = await createConversationAndMessage();
  const connector: ChatConnector = {
    async *run(execution) {
      yield* handoffRequestEvents(execution);
    },
  };
  const worker = new RunWorker(database, events, () => connector, {
    leaseMs: 30_000,
    maxAttempts: 3,
  });
  await worker.processNext();
  const request = await database
    .selectFrom('structured_input_requests')
    .select('request_id')
    .executeTakeFirstOrThrow();
  return { conversationId, requestId: request.request_id };
}

async function* handoffRequestEvents(execution: Parameters<ChatConnector['run']>[0]) {
  const base = {
    visibility: 'public' as const,
    conversationId: execution.request.conversationId,
    runId: execution.request.runId,
  };
  yield { ...base, type: 'run.started' as const, data: { agentRef: execution.request.agentRef } };
  yield {
    ...base,
    type: 'message.started' as const,
    messageId: execution.assistantMessageId,
    data: { role: 'assistant' as const },
  };
  yield {
    ...base,
    type: 'message.completed' as const,
    messageId: execution.assistantMessageId,
    data: { parts: [{ type: 'text' as const, text: 'I will connect you with our team.' }] },
  };
  yield { ...base, type: 'handoff.requested' as const, data: { handoffId: base.runId } };
  yield {
    ...base,
    type: 'contact.requested' as const,
    data: {
      requestId: base.runId,
      inputKind: 'email' as const,
      purpose: 'handoff_email_delivery' as const,
      prompt: 'Where can our team reach you?',
      required: true,
    },
  };
}

function submitInput(
  conversationId: string,
  requestId: string,
  payload: Record<string, unknown>,
  idempotencyKey = crypto.randomUUID(),
) {
  return server.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/inputs/${requestId}`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'idempotency-key': idempotencyKey,
    },
    payload,
  });
}
