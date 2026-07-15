import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createIndex('sites_tenant_site_unique')
    .unique()
    .on('sites')
    .columns(['tenant_id', 'site_id'])
    .execute();

  await database.schema
    .createTable('principals')
    .addColumn('principal_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('kind', 'varchar(32)', (column) => column.notNull())
    .addColumn('browser_identity', 'varchar(128)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addUniqueConstraint('principals_browser_identity_unique', [
      'tenant_id',
      'site_id',
      'browser_identity',
    ])
    .addUniqueConstraint('principals_tenant_site_principal_unique', [
      'tenant_id',
      'site_id',
      'principal_id',
    ])
    .addCheckConstraint('principals_kind_check', sql`kind = 'anonymous'`)
    .addForeignKeyConstraint(
      'principals_tenant_site_foreign',
      ['tenant_id', 'site_id'],
      'sites',
      ['tenant_id', 'site_id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await database.schema
    .createTable('browser_sessions')
    .addColumn('session_id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('tenant_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('site_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('principal_id', 'varchar(128)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('browser_sessions_principal_unique', [
      'tenant_id',
      'site_id',
      'principal_id',
    ])
    .addForeignKeyConstraint(
      'browser_sessions_principal_foreign',
      ['tenant_id', 'site_id', 'principal_id'],
      'principals',
      ['tenant_id', 'site_id', 'principal_id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await database.schema
    .createTable('session_bootstrap_idempotency')
    .addColumn('site_id', 'varchar(128)', (column) =>
      column.notNull().references('sites.site_id').onDelete('cascade'),
    )
    .addColumn('idempotency_key', 'varchar(255)', (column) => column.notNull())
    .addColumn('request_hash', 'char(64)', (column) => column.notNull())
    .addColumn('browser_identity', 'varchar(128)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .addPrimaryKeyConstraint('session_bootstrap_idempotency_primary', [
      'site_id',
      'idempotency_key',
    ])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('session_bootstrap_idempotency').execute();
  await database.schema.dropTable('browser_sessions').execute();
  await database.schema.dropTable('principals').execute();
  await database.schema.dropIndex('sites_tenant_site_unique').execute();
}
