import { afterAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/database/database.js';
import { migrateDatabase } from '../src/database/migrate.js';

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
            'principals',
            'browser_sessions',
            'session_bootstrap_idempotency',
            'conversations',
            'conversation_participants',
            'messages',
            'command_idempotency',
          ].includes(name),
        )
        .sort(),
    ).toEqual([
      'browser_sessions',
      'command_idempotency',
      'conversation_participants',
      'conversations',
      'messages',
      'principals',
      'session_bootstrap_idempotency',
      'sites',
      'tenants',
    ]);
  });

  it('stores tenant-scoped sites', async () => {
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
});
