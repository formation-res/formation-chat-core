import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('agent_runs')
    .dropConstraint('agent_runs_status_check')
    .execute();
  await database.schema
    .alterTable('agent_runs')
    .addCheckConstraint(
      'agent_runs_status_check',
      sql`status in ('queued', 'running', 'waiting_for_input', 'completed', 'failed', 'cancel_requested', 'cancelled')`,
    )
    .execute();

  await database.schema
    .createTable('handoffs')
    .addColumn('handoff_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('conversation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('run_id', 'varchar(128)', (column) => column.notNull().unique())
    .addColumn('status', 'varchar(32)', (column) => column.notNull().defaultTo('requested'))
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addCheckConstraint(
      'handoffs_status_check',
      sql`status in ('requested', 'awaiting_contact', 'delivering', 'completed', 'failed')`,
    )
    .addForeignKeyConstraint(
      'handoffs_run_foreign',
      ['run_id'],
      'agent_runs',
      ['run_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await database.schema
    .createTable('structured_input_requests')
    .addColumn('request_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('conversation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('run_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('input_kind', 'varchar(32)', (column) => column.notNull())
    .addColumn('purpose', 'varchar(64)', (column) => column.notNull())
    .addColumn('prompt', 'varchar(500)', (column) => column.notNull())
    .addColumn('required', 'boolean', (column) => column.notNull())
    .addColumn('status', 'varchar(32)', (column) => column.notNull().defaultTo('pending'))
    .addColumn('value', 'varchar(320)')
    .addColumn('consent_status', 'varchar(32)')
    .addColumn('consent_recorded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addCheckConstraint('structured_input_kind_check', sql`input_kind = 'email'`)
    .addCheckConstraint('structured_input_purpose_check', sql`purpose = 'handoff_email_delivery'`)
    .addCheckConstraint(
      'structured_input_status_check',
      sql`status in ('pending', 'submitted', 'declined', 'expired')`,
    )
    .addCheckConstraint(
      'structured_input_resolution_check',
      sql`(status = 'pending' and value is null and consent_status is null and consent_recorded_at is null)
          or (status = 'submitted' and value is not null and consent_status = 'granted' and consent_recorded_at is not null)
          or (status = 'declined' and value is null and consent_status = 'declined' and consent_recorded_at is not null)
          or status = 'expired'`,
    )
    .addForeignKeyConstraint(
      'structured_input_run_foreign',
      ['run_id'],
      'agent_runs',
      ['run_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('structured_input_requests').execute();
  await database.schema.dropTable('handoffs').execute();
  await database.schema
    .alterTable('agent_runs')
    .dropConstraint('agent_runs_status_check')
    .execute();
  await database.schema
    .alterTable('agent_runs')
    .addCheckConstraint(
      'agent_runs_status_check',
      sql`status in ('queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled')`,
    )
    .execute();
}
