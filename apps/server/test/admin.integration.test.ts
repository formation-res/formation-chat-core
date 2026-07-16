import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AdminQueryService } from '../src/admin/service.js';
import { AdminTokenService } from '../src/admin/token.js';
import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { buildServer } from '../src/server.js';
import { SessionTokenService } from '../src/session/token.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');
const database = createDatabase({ databaseUrl, databasePoolMax: 4 });
const adminTokens = new AdminTokenService('admin-secret-0123456789abcdef0123456789abcdef', 600);
const sessionTokens = new SessionTokenService(
  'public-secret-0123456789abcdef0123456789abcdef',
  600,
);
const server = buildServer({
  checkDatabase: async () => undefined,
  adminService: new AdminQueryService(database),
  adminTokens,
  logger: false,
});
let readToken: string;
let internalToken: string;

beforeAll(async () => {
  await migrateDatabase(database);
});

beforeEach(async () => {
  await clearDatabase();
  await seedAdminData();
  readToken = (
    await adminTokens.issue({
      adminId: 'operator-read',
      tenantId: 'tenant-admin-a',
      siteIds: ['site-admin-a1'],
      scopes: ['admin:read'],
    })
  ).token;
  internalToken = (
    await adminTokens.issue({
      adminId: 'operator-internal',
      tenantId: 'tenant-admin-a',
      siteIds: ['site-admin-a1'],
      scopes: ['admin:internal'],
    })
  ).token;
});

afterAll(async () => {
  await server.close();
  await database.destroy();
});

describe('admin query API', () => {
  it('uses separate authentication and applies tenant and site restrictions', async () => {
    const publicToken = (
      await sessionTokens.issue({
        tenantId: 'tenant-admin-a',
        siteId: 'site-admin-a1',
        principalId: 'principal-a1',
        sessionId: 'session-public',
      })
    ).token;
    const publicResponse = await request('/v1/admin/conversations', publicToken);
    const readResponse = await request('/v1/admin/conversations', readToken);

    expect(publicResponse.statusCode).toBe(401);
    expect(readResponse.statusCode).toBe(200);
    expect(
      readResponse
        .json()
        .data.map(({ conversationId }: { conversationId: string }) => conversationId),
    ).toEqual(['conversation-a1-new', 'conversation-a1-old']);
    expect(JSON.stringify(readResponse.json())).not.toContain('conversation-a2');
    expect(JSON.stringify(readResponse.json())).not.toContain('conversation-b1');
  });

  it('cursor-pages and filters conversations within the token site set', async () => {
    const first = await request('/v1/admin/conversations?limit=1&status=active', readToken);
    const cursor = first.json().pagination.nextCursor as string;
    const second = await request(
      `/v1/admin/conversations?limit=1&status=active&cursor=${cursor}`,
      readToken,
    );
    const forbiddenSite = await request('/v1/admin/conversations?siteId=site-admin-a2', readToken);

    expect(
      first.json().data.map(({ conversationId }: { conversationId: string }) => conversationId),
    ).toEqual(['conversation-a1-new']);
    expect(first.json().pagination.hasMore).toBe(true);
    expect(
      second.json().data.map(({ conversationId }: { conversationId: string }) => conversationId),
    ).toEqual(['conversation-a1-old']);
    expect(forbiddenSite.statusCode).toBe(403);
  });

  it('returns scoped conversation details and canonical message pages', async () => {
    const detail = await request('/v1/admin/conversations/conversation-a1-new', readToken);
    const messages = await request(
      '/v1/admin/conversations/conversation-a1-new/messages?limit=1',
      readToken,
    );
    const hidden = await request('/v1/admin/conversations/conversation-a2', readToken);

    expect(detail.statusCode).toBe(200);
    expect(detail.json().conversationId).toBe('conversation-a1-new');
    expect(messages.json().data[0]).toMatchObject({ messageId: 'message-a1-user', sequence: 1 });
    expect(messages.json().pagination.hasMore).toBe(true);
    expect(hidden.statusCode).toBe(404);
  });

  it('filters event visibility by operator versus internal scope', async () => {
    const operator = await request('/v1/admin/conversations/conversation-a1-new/events', readToken);
    const internal = await request(
      '/v1/admin/conversations/conversation-a1-new/events',
      internalToken,
    );

    expect(
      operator.json().data.map(({ visibility }: { visibility: string }) => visibility),
    ).toEqual(['public', 'operator']);
    expect(
      internal.json().data.map(({ visibility }: { visibility: string }) => visibility),
    ).toEqual(['public', 'operator', 'internal']);
  });

  it('cursor-pages and filters connector runs', async () => {
    const first = await request('/v1/admin/runs?limit=1', readToken);
    const second = await request(
      `/v1/admin/runs?limit=1&cursor=${first.json().pagination.nextCursor}`,
      readToken,
    );
    const billing = await request('/v1/admin/runs?agentRef=billing', readToken);
    const recent = await request('/v1/admin/runs?createdAfter=2026-07-16T11:15:00.000Z', readToken);
    const wrongCursorKind = await request(
      `/v1/admin/runs?cursor=${
        (await request('/v1/admin/conversations?limit=1', readToken)).json().pagination.nextCursor
      }`,
      readToken,
    );

    expect(first.json().data.map(({ runId }: { runId: string }) => runId)).toEqual([
      'run-a1-failed',
    ]);
    expect(second.json().data.map(({ runId }: { runId: string }) => runId)).toEqual([
      'run-a1-completed',
    ]);
    expect(billing.json().data.map(({ runId }: { runId: string }) => runId)).toEqual([
      'run-a1-completed',
    ]);
    expect(recent.json().data.map(({ runId }: { runId: string }) => runId)).toEqual([
      'run-a1-failed',
    ]);
    expect(wrongCursorKind.statusCode).toBe(400);
  });

  it('lists failures separately with safe error codes and no hidden-site records', async () => {
    const failures = await request('/v1/admin/failures', readToken);
    const invalidRange = await request(
      '/v1/admin/failures?createdAfter=2026-07-16T12:00:00.000Z&createdBefore=2026-07-16T11:00:00.000Z',
      readToken,
    );

    expect(failures.statusCode).toBe(200);
    expect(failures.json().data).toEqual([
      expect.objectContaining({
        runId: 'run-a1-failed',
        status: 'failed',
        errorCode: 'CONNECTOR_TIMEOUT',
      }),
    ]);
    expect(JSON.stringify(failures.json())).not.toContain('run-a2-failed');
    expect(JSON.stringify(failures.json())).not.toContain('run-b1-failed');
    expect(invalidRange.statusCode).toBe(400);
  });

  it('lists and filters handoffs without exposing structured contact values', async () => {
    const failed = await request('/v1/admin/handoffs?status=failed', readToken);
    const all = await request('/v1/admin/handoffs', readToken);

    expect(failed.json().data).toEqual([
      expect.objectContaining({ handoffId: 'handoff-a1-failed', status: 'failed' }),
    ]);
    expect(all.json().data.map(({ handoffId }: { handoffId: string }) => handoffId)).toEqual([
      'handoff-a1-failed',
      'handoff-a1-completed',
    ]);
    expect(JSON.stringify(all.json())).not.toContain('visitor@example.com');
    expect(JSON.stringify(all.json())).not.toContain('handoff-a2');
  });
});

function request(url: string, token: string) {
  return server.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

async function clearDatabase(): Promise<void> {
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
}

async function seedAdminData(): Promise<void> {
  await database
    .insertInto('tenants')
    .values([
      { tenant_id: 'tenant-admin-a', display_name: 'Tenant A' },
      { tenant_id: 'tenant-admin-b', display_name: 'Tenant B' },
    ])
    .execute();
  await database
    .insertInto('sites')
    .values([
      site('site-admin-a1', 'tenant-admin-a'),
      site('site-admin-a2', 'tenant-admin-a'),
      site('site-admin-b1', 'tenant-admin-b'),
    ])
    .execute();
  await database
    .insertInto('principals')
    .values([
      principal('principal-a1', 'tenant-admin-a', 'site-admin-a1'),
      principal('principal-a2', 'tenant-admin-a', 'site-admin-a2'),
      principal('principal-b1', 'tenant-admin-b', 'site-admin-b1'),
    ])
    .execute();
  await insertConversation(
    'conversation-a1-old',
    'tenant-admin-a',
    'site-admin-a1',
    'principal-a1',
    new Date('2026-07-16T10:00:00Z'),
    'billing',
  );
  await insertConversation(
    'conversation-a1-new',
    'tenant-admin-a',
    'site-admin-a1',
    'principal-a1',
    new Date('2026-07-16T11:00:00Z'),
  );
  await insertConversation(
    'conversation-a2',
    'tenant-admin-a',
    'site-admin-a2',
    'principal-a2',
    new Date('2026-07-16T12:00:00Z'),
  );
  await insertConversation(
    'conversation-b1',
    'tenant-admin-b',
    'site-admin-b1',
    'principal-b1',
    new Date('2026-07-16T13:00:00Z'),
  );

  await database
    .insertInto('messages')
    .values([
      message('message-a1-user', 1, 'participant-conversation-a1-new-user', 'user', 'Hello'),
      message('message-a1-agent', 2, 'participant-conversation-a1-new-agent', 'assistant', 'Hi'),
      scopedMessage(
        'message-a1-old',
        'tenant-admin-a',
        'site-admin-a1',
        'conversation-a1-old',
        'participant-conversation-a1-old-user',
      ),
      scopedMessage(
        'message-a2',
        'tenant-admin-a',
        'site-admin-a2',
        'conversation-a2',
        'participant-conversation-a2-user',
      ),
      scopedMessage(
        'message-b1',
        'tenant-admin-b',
        'site-admin-b1',
        'conversation-b1',
        'participant-conversation-b1-user',
      ),
    ])
    .execute();
  await database
    .insertInto('conversation_events')
    .values([
      event('event-public', 1, 'public'),
      event('event-operator', 2, 'operator'),
      event('event-internal', 3, 'internal'),
    ])
    .execute();
  await database
    .insertInto('agent_runs')
    .values([
      run(
        'run-a1-failed',
        'tenant-admin-a',
        'site-admin-a1',
        'conversation-a1-new',
        'message-a1-user',
        'support',
        'failed',
        new Date('2026-07-16T11:20:00Z'),
        'CONNECTOR_TIMEOUT',
      ),
      run(
        'run-a1-completed',
        'tenant-admin-a',
        'site-admin-a1',
        'conversation-a1-old',
        'message-a1-old',
        'billing',
        'completed',
        new Date('2026-07-16T11:10:00Z'),
      ),
      run(
        'run-a2-failed',
        'tenant-admin-a',
        'site-admin-a2',
        'conversation-a2',
        'message-a2',
        'support',
        'failed',
        new Date('2026-07-16T12:20:00Z'),
        'PRIVATE_SITE_FAILURE',
      ),
      run(
        'run-b1-failed',
        'tenant-admin-b',
        'site-admin-b1',
        'conversation-b1',
        'message-b1',
        'support',
        'failed',
        new Date('2026-07-16T13:20:00Z'),
        'PRIVATE_TENANT_FAILURE',
      ),
    ])
    .execute();
  await database
    .insertInto('handoffs')
    .values([
      handoff(
        'handoff-a1-failed',
        'run-a1-failed',
        'tenant-admin-a',
        'site-admin-a1',
        'conversation-a1-new',
        'failed',
        new Date('2026-07-16T11:22:00Z'),
      ),
      handoff(
        'handoff-a1-completed',
        'run-a1-completed',
        'tenant-admin-a',
        'site-admin-a1',
        'conversation-a1-old',
        'completed',
        new Date('2026-07-16T11:12:00Z'),
      ),
      handoff(
        'handoff-a2',
        'run-a2-failed',
        'tenant-admin-a',
        'site-admin-a2',
        'conversation-a2',
        'failed',
        new Date('2026-07-16T12:22:00Z'),
      ),
    ])
    .execute();
}

const site = (siteId: string, tenantId: string) => ({
  site_id: siteId,
  tenant_id: tenantId,
  site_key: siteId,
  display_name: siteId,
  allowed_origins: JSON.stringify(['https://example.com']),
  agent_ref: 'support',
});

const principal = (principalId: string, tenantId: string, siteId: string) => ({
  principal_id: principalId,
  tenant_id: tenantId,
  site_id: siteId,
  kind: 'anonymous' as const,
  browser_identity: `browser-${principalId}`,
});

async function insertConversation(
  conversationId: string,
  tenantId: string,
  siteId: string,
  principalId: string,
  createdAt: Date,
  agentRef = 'support',
): Promise<void> {
  await database
    .insertInto('conversations')
    .values({
      conversation_id: conversationId,
      tenant_id: tenantId,
      site_id: siteId,
      principal_id: principalId,
      agent_ref: agentRef,
      status: 'active',
      created_at: createdAt,
      updated_at: createdAt,
    })
    .execute();
  await database
    .insertInto('conversation_participants')
    .values([
      {
        participant_id: `participant-${conversationId}-user`,
        tenant_id: tenantId,
        site_id: siteId,
        conversation_id: conversationId,
        kind: 'user',
        principal_id: principalId,
        agent_ref: null,
      },
      {
        participant_id: `participant-${conversationId}-agent`,
        tenant_id: tenantId,
        site_id: siteId,
        conversation_id: conversationId,
        kind: 'agent',
        principal_id: null,
        agent_ref: agentRef,
      },
    ])
    .execute();
}

const message = (
  messageId: string,
  sequence: number,
  participantId: string,
  role: 'user' | 'assistant',
  text: string,
) => ({
  message_id: messageId,
  tenant_id: 'tenant-admin-a',
  site_id: 'site-admin-a1',
  conversation_id: 'conversation-a1-new',
  sequence,
  participant_id: participantId,
  role,
  status: 'completed' as const,
  parts: JSON.stringify([{ type: 'text', text }]),
  created_at: new Date(`2026-07-16T11:0${sequence}:00Z`),
  completed_at: new Date(`2026-07-16T11:0${sequence}:00Z`),
});

const event = (
  eventId: string,
  sequence: number,
  visibility: 'public' | 'operator' | 'internal',
) => ({
  event_id: eventId,
  tenant_id: 'tenant-admin-a',
  site_id: 'site-admin-a1',
  conversation_id: 'conversation-a1-new',
  sequence,
  type: 'run.started',
  visibility,
  run_id: 'run-event',
  message_id: null,
  data: JSON.stringify({ agentRef: 'support' }),
  occurred_at: new Date(`2026-07-16T11:1${sequence}:00Z`),
});

const scopedMessage = (
  messageId: string,
  tenantId: string,
  siteId: string,
  conversationId: string,
  participantId: string,
) => ({
  message_id: messageId,
  tenant_id: tenantId,
  site_id: siteId,
  conversation_id: conversationId,
  sequence: 1,
  participant_id: participantId,
  role: 'user' as const,
  status: 'completed' as const,
  parts: JSON.stringify([{ type: 'text', text: 'Seed' }]),
  created_at: new Date('2026-07-16T10:00:00Z'),
  completed_at: new Date('2026-07-16T10:00:00Z'),
});

const run = (
  runId: string,
  tenantId: string,
  siteId: string,
  conversationId: string,
  triggerMessageId: string,
  agentRef: string,
  status: 'completed' | 'failed',
  createdAt: Date,
  errorCode: string | null = null,
) => ({
  run_id: runId,
  tenant_id: tenantId,
  site_id: siteId,
  conversation_id: conversationId,
  trigger_message_id: triggerMessageId,
  assistant_message_id: `assistant-${runId}`,
  agent_ref: agentRef,
  status,
  attempt: status === 'failed' ? 2 : 1,
  available_at: createdAt,
  claimed_at: createdAt,
  lease_expires_at: null,
  cancel_requested_at: null,
  error_code: errorCode,
  created_at: createdAt,
  updated_at: createdAt,
  completed_at: createdAt,
});

const handoff = (
  handoffId: string,
  runId: string,
  tenantId: string,
  siteId: string,
  conversationId: string,
  status: 'completed' | 'failed',
  createdAt: Date,
) => ({
  handoff_id: handoffId,
  run_id: runId,
  tenant_id: tenantId,
  site_id: siteId,
  conversation_id: conversationId,
  status,
  created_at: createdAt,
  updated_at: createdAt,
});
