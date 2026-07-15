import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('conversations')
    .addColumn('next_event_sequence', 'integer', (column) => column.notNull().defaultTo(1))
    .execute();

  await database.schema
    .createTable('conversation_events')
    .addColumn('event_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('conversation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('sequence', 'integer', (column) => column.notNull())
    .addColumn('type', 'varchar(64)', (column) => column.notNull())
    .addColumn('visibility', 'varchar(32)', (column) => column.notNull())
    .addColumn('run_id', 'varchar(128)')
    .addColumn('message_id', 'varchar(128)')
    .addColumn('data', 'jsonb', (column) => column.notNull())
    .addColumn('occurred_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addCheckConstraint('conversation_events_sequence_check', sql`sequence >= 1`)
    .addCheckConstraint(
      'conversation_events_visibility_check',
      sql`visibility in ('public', 'operator', 'internal')`,
    )
    .addUniqueConstraint('conversation_events_sequence_unique', ['conversation_id', 'sequence'])
    .addForeignKeyConstraint(
      'conversation_events_conversation_foreign',
      ['tenant_id', 'site_id', 'conversation_id'],
      'conversations',
      ['tenant_id', 'site_id', 'conversation_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await database.schema
    .createIndex('conversation_events_public_replay_index')
    .on('conversation_events')
    .columns(['tenant_id', 'site_id', 'conversation_id', 'visibility', 'sequence'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('conversation_events').execute();
  await database.schema.alterTable('conversations').dropColumn('next_event_sequence').execute();
}
