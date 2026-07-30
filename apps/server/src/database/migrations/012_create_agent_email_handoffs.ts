import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('agent_runs')
    .addColumn('trigger_type', 'varchar(32)', (column) => column.notNull().defaultTo('message'))
    .execute();
  await database.schema
    .alterTable('agent_runs')
    .addCheckConstraint(
      'agent_runs_trigger_type_check',
      sql`trigger_type in ('message', 'agent_email_handoff')`,
    )
    .execute();
  await sql`
    alter table agent_runs
    drop constraint if exists agent_runs_trigger_message_id_key
  `.execute(database);

  await database.schema
    .alterTable('handoffs')
    .addColumn('kind', 'varchar(32)', (column) => column.notNull().defaultTo('human'))
    .execute();
  await database.schema
    .alterTable('handoffs')
    .addCheckConstraint('handoffs_kind_check', sql`kind in ('human', 'agent_email')`)
    .execute();

  await database.schema
    .alterTable('structured_input_requests')
    .dropConstraint('structured_input_purpose_check')
    .execute();
  await database.schema
    .alterTable('structured_input_requests')
    .addCheckConstraint(
      'structured_input_purpose_check',
      sql`purpose in ('handoff_email_delivery', 'agent_email_handoff')`,
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('structured_input_requests')
    .dropConstraint('structured_input_purpose_check')
    .execute();
  await database.schema
    .alterTable('structured_input_requests')
    .addCheckConstraint('structured_input_purpose_check', sql`purpose = 'handoff_email_delivery'`)
    .execute();
  await database.schema.alterTable('handoffs').dropConstraint('handoffs_kind_check').execute();
  await database.schema.alterTable('handoffs').dropColumn('kind').execute();
  await sql`delete from agent_runs where trigger_type = 'agent_email_handoff'`.execute(database);
  await database.schema
    .alterTable('agent_runs')
    .addUniqueConstraint('agent_runs_trigger_message_id_key', ['trigger_message_id'])
    .execute();
  await database.schema
    .alterTable('agent_runs')
    .dropConstraint('agent_runs_trigger_type_check')
    .execute();
  await database.schema.alterTable('agent_runs').dropColumn('trigger_type').execute();
}
