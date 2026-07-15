import { Migrator, type Migration, type MigrationResult } from 'kysely/migration';

import * as createTenantsAndSites from './migrations/001_create_tenants_and_sites.js';
import * as createAnonymousSessions from './migrations/002_create_anonymous_sessions.js';
import * as createConversationsAndMessages from './migrations/003_create_conversations_and_messages.js';
import type { Database } from './database.js';

const migrations: Record<string, Migration> = {
  '001_create_tenants_and_sites': createTenantsAndSites,
  '002_create_anonymous_sessions': createAnonymousSessions,
  '003_create_conversations_and_messages': createConversationsAndMessages,
};

export class DatabaseMigrationError extends Error {
  constructor() {
    super('Database migration failed.');
    this.name = 'DatabaseMigrationError';
  }
}

export async function migrateDatabase(database: Database): Promise<readonly MigrationResult[]> {
  const migrator = new Migrator({
    db: database,
    provider: { getMigrations: async () => migrations },
  });
  const result = await migrator.migrateToLatest();

  if (result.error) throw new DatabaseMigrationError();
  return result.results ?? [];
}
