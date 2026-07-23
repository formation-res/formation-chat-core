import { afterAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { DatabaseAuditSink } from '../src/security/audit.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const database = createDatabase({ databaseUrl, databasePoolMax: 2 });

afterAll(async () => database.destroy());

describe('PostgreSQL persistence base', () => {
  it('migrates a clean database and is repeatable', async () => {
    const first = await migrateDatabase(database);
    const second = await migrateDatabase(database);

    expect(first.every((migration) => migration.status === 'Success')).toBe(true);
    expect(second).toEqual([]);
    const tables = await database.introspection.getTables();
    expect(
      tables
        .map((table) => table.name)
        .filter((name) =>
          [
            'tenants',
            'sites',
            'site_widgets',
            'principals',
            'browser_sessions',
            'session_bootstrap_idempotency',
            'conversations',
            'conversation_participants',
            'messages',
            'command_idempotency',
            'conversation_events',
            'agent_runs',
            'audit_events',
          ].includes(name),
        )
        .sort(),
    ).toEqual([
      'agent_runs',
      'audit_events',
      'browser_sessions',
      'command_idempotency',
      'conversation_events',
      'conversation_participants',
      'conversations',
      'messages',
      'principals',
      'session_bootstrap_idempotency',
      'site_widgets',
      'sites',
      'tenants',
    ]);
  });

  it('stores tenant-scoped sites', async () => {
    await database.deleteFrom('audit_events').execute();
    await database.deleteFrom('conversation_events').execute();
    await database.deleteFrom('command_idempotency').execute();
    await database.deleteFrom('agent_runs').execute();
    await database.deleteFrom('messages').execute();
    await database.deleteFrom('conversation_participants').execute();
    await database.deleteFrom('conversations').execute();
    await database.deleteFrom('session_bootstrap_idempotency').execute();
    await database.deleteFrom('browser_sessions').execute();
    await database.deleteFrom('principals').execute();
    await database.deleteFrom('site_widgets').execute();
    await database.deleteFrom('sites').execute();
    await database.deleteFrom('tenants').execute();
    await database
      .insertInto('tenants')
      .values({ tenant_id: 'tenant-test', display_name: 'Test tenant' })
      .execute();
    await database
      .insertInto('sites')
      .values({
        site_id: 'site-test',
        tenant_id: 'tenant-test',
        site_key: 'public-site-key',
        display_name: 'Test site',
        allowed_origins: JSON.stringify(['https://example.test']),
        agent_ref: 'agent-test',
      })
      .execute();

    const site = await database
      .selectFrom('sites')
      .select(['tenant_id', 'allowed_origins'])
      .where('tenant_id', '=', 'tenant-test')
      .where('site_id', '=', 'site-test')
      .executeTakeFirstOrThrow();

    expect(site).toEqual({
      tenant_id: 'tenant-test',
      allowed_origins: ['https://example.test'],
    });
  });

  it('persists only the bounded audit event fields', async () => {
    await database.deleteFrom('audit_events').execute();
    const audit = new DatabaseAuditSink(database);

    await audit.record({
      correlationId: 'correlation-test',
      actorKind: 'admin',
      actorId: 'operator-test',
      tenantId: 'tenant-test',
      siteId: 'site-test',
      action: 'GET /v1/admin/conversations',
      outcome: 'success',
      statusCode: 200,
    });

    const event = await database
      .selectFrom('audit_events')
      .select([
        'correlation_id',
        'actor_kind',
        'actor_id',
        'tenant_id',
        'site_id',
        'action',
        'outcome',
        'status_code',
      ])
      .executeTakeFirstOrThrow();
    expect(event).toEqual({
      correlation_id: 'correlation-test',
      actor_kind: 'admin',
      actor_id: 'operator-test',
      tenant_id: 'tenant-test',
      site_id: 'site-test',
      action: 'GET /v1/admin/conversations',
      outcome: 'success',
      status_code: 200,
    });
    expect(JSON.stringify(event)).not.toMatch(/authorization|email|payload/i);
  });
});
