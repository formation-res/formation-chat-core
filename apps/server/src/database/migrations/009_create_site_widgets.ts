import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('site_widgets')
    .addColumn('widget_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('widget_key', 'varchar(128)', (column) => column.notNull().unique())
    .addColumn('display_name', 'varchar(200)', (column) => column.notNull())
    .addColumn('version', 'varchar(128)', (column) => column.notNull())
    .addColumn('theme', 'varchar(128)', (column) => column.notNull())
    .addColumn('launcher', 'varchar(128)', (column) => column.notNull())
    .addColumn('placement', 'varchar(128)', (column) => column.notNull())
    .addColumn('default_agent_alias', 'varchar(128)', (column) => column.notNull())
    .addColumn('agent_aliases', 'jsonb', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addForeignKeyConstraint(
      'site_widgets_site_foreign',
      ['tenant_id', 'site_id'],
      'sites',
      ['tenant_id', 'site_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await database.schema
    .createIndex('site_widgets_site_index')
    .on('site_widgets')
    .columns(['tenant_id', 'site_id', 'display_name', 'widget_id'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('site_widgets').execute();
}
