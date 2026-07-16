import { Migrator, type Migration, type MigrationResult } from 'kysely/migration';

import * as createTenantsAndSites from './migrations/001_create_tenants_and_sites.js';
import * as createAnonymousSessions from './migrations/002_create_anonymous_sessions.js';
import * as createConversationsAndMessages from './migrations/003_create_conversations_and_messages.js';
import * as createConversationEvents from './migrations/004_create_conversation_events.js';
import * as createAgentRuns from './migrations/005_create_agent_runs.js';
import * as createHandoffsAndStructuredInputs from './migrations/006_create_handoffs_and_structured_inputs.js';
import * as createAdminQueryIndexes from './migrations/007_create_admin_query_indexes.js';
import * as createAuditEvents from './migrations/008_create_audit_events.js';
import type { Database } from './database.js';

const migrations: Record<string, Migration> = {
  '001_create_tenants_and_sites': createTenantsAndSites,
  '002_create_anonymous_sessions': createAnonymousSessions,
  '003_create_conversations_and_messages': createConversationsAndMessages,
  '004_create_conversation_events': createConversationEvents,
  '005_create_agent_runs': createAgentRuns,
  '006_create_handoffs_and_structured_inputs': createHandoffsAndStructuredInputs,
  '007_create_admin_query_indexes': createAdminQueryIndexes,
  '008_create_audit_events': createAuditEvents,
};

export class DatabaseMigrationError extends Error {
  constructor(cause?: unknown) {
    super('Database migration failed.', { cause });
    this.name = 'DatabaseMigrationError';
  }
}

export async function migrateDatabase(database: Database): Promise<readonly MigrationResult[]> {
  const migrator = new Migrator({
    db: database,
    provider: { getMigrations: async () => migrations },
  });
  const result = await migrator.migrateToLatest();

  if (result.error) throw new DatabaseMigrationError(result.error);
  return result.results ?? [];
}
