import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('agent_runs')
    .addColumn('run_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('conversation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('trigger_message_id', 'varchar(128)', (column) => column.notNull().unique())
    .addColumn('assistant_message_id', 'varchar(128)', (column) => column.notNull().unique())
    .addColumn('agent_ref', 'varchar(128)', (column) => column.notNull())
    .addColumn('status', 'varchar(32)', (column) => column.notNull().defaultTo('queued'))
    .addColumn('attempt', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('available_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('claimed_at', 'timestamptz')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('cancel_requested_at', 'timestamptz')
    .addColumn('error_code', 'varchar(64)')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('completed_at', 'timestamptz')
    .addCheckConstraint('agent_runs_attempt_check', sql`attempt >= 0`)
    .addCheckConstraint(
      'agent_runs_status_check',
      sql`status in ('queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled')`,
    )
    .addForeignKeyConstraint(
      'agent_runs_conversation_foreign',
      ['tenant_id', 'site_id', 'conversation_id'],
      'conversations',
      ['tenant_id', 'site_id', 'conversation_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'agent_runs_trigger_message_foreign',
      ['trigger_message_id'],
      'messages',
      ['message_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await database.schema
    .createIndex('agent_runs_claim_index')
    .on('agent_runs')
    .columns(['status', 'available_at', 'created_at'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('agent_runs').execute();
}
