import type { Kysely } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createIndex('conversations_admin_list_index')
    .on('conversations')
    .columns(['tenant_id', 'site_id', 'created_at', 'conversation_id'])
    .execute();
  await database.schema
    .createIndex('conversation_events_admin_timeline_index')
    .on('conversation_events')
    .columns(['tenant_id', 'site_id', 'conversation_id', 'sequence'])
    .execute();
  await database.schema
    .createIndex('agent_runs_admin_list_index')
    .on('agent_runs')
    .columns(['tenant_id', 'site_id', 'created_at', 'run_id'])
    .execute();
  await database.schema
    .createIndex('agent_runs_admin_filter_index')
    .on('agent_runs')
    .columns(['tenant_id', 'site_id', 'agent_ref', 'status', 'created_at', 'run_id'])
    .execute();
  await database.schema
    .createIndex('handoffs_admin_list_index')
    .on('handoffs')
    .columns(['tenant_id', 'site_id', 'status', 'created_at', 'handoff_id'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropIndex('handoffs_admin_list_index').execute();
  await database.schema.dropIndex('agent_runs_admin_filter_index').execute();
  await database.schema.dropIndex('agent_runs_admin_list_index').execute();
  await database.schema.dropIndex('conversation_events_admin_timeline_index').execute();
  await database.schema.dropIndex('conversations_admin_list_index').execute();
}
