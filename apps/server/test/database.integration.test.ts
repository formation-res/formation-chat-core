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

    expect(first).toContainEqual(
      expect.objectContaining({ migrationName: '001_create_tenants_and_sites', status: 'Success' }),
    );
    expect(second).toEqual([]);
  });

  it('stores tenant-scoped sites', async () => {
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
