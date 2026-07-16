import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('audit_events')
    .addColumn('audit_event_id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('correlation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('actor_kind', 'varchar(16)', (column) => column.notNull())
    .addColumn('actor_id', 'varchar(128)')
    .addColumn('tenant_id', 'varchar(128)')
    .addColumn('site_id', 'varchar(128)')
    .addColumn('action', 'varchar(200)', (column) => column.notNull())
    .addColumn('outcome', 'varchar(16)', (column) => column.notNull())
    .addColumn('status_code', 'integer', (column) => column.notNull())
    .addColumn('occurred_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addCheckConstraint(
      'audit_events_actor_kind_check',
      sql`actor_kind in ('anonymous', 'admin', 'system')`,
    )
    .addCheckConstraint(
      'audit_events_outcome_check',
      sql`outcome in ('success', 'denied', 'failure')`,
    )
    .execute();
  await database.schema
    .createIndex('audit_events_scope_time_index')
    .on('audit_events')
    .columns(['tenant_id', 'site_id', 'occurred_at'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('audit_events').execute();
}
