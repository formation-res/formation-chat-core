import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('tenants')
    .addColumn('tenant_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('display_name', 'varchar(200)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .execute();

  await database.schema
    .createTable('sites')
    .addColumn('site_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) =>
      column.notNull().references('tenants.tenant_id').onDelete('restrict'),
    )
    .addColumn('site_key', 'varchar(128)', (column) => column.notNull().unique())
    .addColumn('display_name', 'varchar(200)', (column) => column.notNull())
    .addColumn('allowed_origins', 'jsonb', (column) => column.notNull())
    .addColumn('agent_ref', 'varchar(128)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .execute();

  await database.schema
    .createIndex('sites_tenant_id_index')
    .on('sites')
    .column('tenant_id')
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('sites').execute();
  await database.schema.dropTable('tenants').execute();
}
