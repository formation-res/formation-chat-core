import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('conversations')
    .addColumn('conversation_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('principal_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('agent_ref', 'varchar(128)', (column) => column.notNull())
    .addColumn('status', 'varchar(32)', (column) => column.notNull().defaultTo('active'))
    .addColumn('next_message_sequence', 'integer', (column) => column.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addCheckConstraint(
      'conversations_status_check',
      sql`status in ('active', 'completed', 'cancelled')`,
    )
    .addUniqueConstraint('conversations_scope_unique', ['tenant_id', 'site_id', 'conversation_id'])
    .addForeignKeyConstraint(
      'conversations_principal_foreign',
      ['tenant_id', 'site_id', 'principal_id'],
      'principals',
      ['tenant_id', 'site_id', 'principal_id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await database.schema
    .createIndex('conversations_principal_list_index')
    .on('conversations')
    .columns(['tenant_id', 'site_id', 'principal_id', 'created_at', 'conversation_id'])
    .execute();

  await database.schema
    .createTable('conversation_participants')
    .addColumn('participant_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('conversation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('kind', 'varchar(32)', (column) => column.notNull())
    .addColumn('principal_id', 'varchar(128)')
    .addColumn('agent_ref', 'varchar(128)')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addCheckConstraint(
      'conversation_participants_kind_check',
      sql`(kind = 'user' and principal_id is not null and agent_ref is null)
        or (kind = 'agent' and principal_id is null and agent_ref is not null)`,
    )
    .addUniqueConstraint('conversation_participants_kind_unique', ['conversation_id', 'kind'])
    .addUniqueConstraint('conversation_participants_scope_unique', [
      'tenant_id',
      'site_id',
      'conversation_id',
      'participant_id',
    ])
    .addForeignKeyConstraint(
      'conversation_participants_conversation_foreign',
      ['tenant_id', 'site_id', 'conversation_id'],
      'conversations',
      ['tenant_id', 'site_id', 'conversation_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await database.schema
    .createTable('messages')
    .addColumn('message_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('conversation_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('sequence', 'integer', (column) => column.notNull())
    .addColumn('participant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('role', 'varchar(32)', (column) => column.notNull())
    .addColumn('status', 'varchar(32)', (column) => column.notNull())
    .addColumn('parts', 'jsonb', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('completed_at', 'timestamptz')
    .addCheckConstraint('messages_sequence_check', sql`sequence >= 1`)
    .addCheckConstraint('messages_role_check', sql`role in ('user', 'assistant', 'system')`)
    .addCheckConstraint(
      'messages_status_check',
      sql`status in ('pending', 'streaming', 'completed', 'failed', 'cancelled')`,
    )
    .addUniqueConstraint('messages_sequence_unique', ['conversation_id', 'sequence'])
    .addForeignKeyConstraint(
      'messages_participant_foreign',
      ['tenant_id', 'site_id', 'conversation_id', 'participant_id'],
      'conversation_participants',
      ['tenant_id', 'site_id', 'conversation_id', 'participant_id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await database.schema
    .createTable('command_idempotency')
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('principal_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('operation', 'varchar(200)', (column) => column.notNull())
    .addColumn('idempotency_key', 'varchar(255)', (column) => column.notNull())
    .addColumn('request_hash', 'char(64)', (column) => column.notNull())
    .addColumn('resource_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addPrimaryKeyConstraint('command_idempotency_primary', [
      'tenant_id',
      'site_id',
      'principal_id',
      'operation',
      'idempotency_key',
    ])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('command_idempotency').execute();
  await database.schema.dropTable('messages').execute();
  await database.schema.dropTable('conversation_participants').execute();
  await database.schema.dropTable('conversations').execute();
}
