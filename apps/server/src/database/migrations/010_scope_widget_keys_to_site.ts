import type { Kysely } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('site_widgets')
    .dropConstraint('site_widgets_widget_key_key')
    .execute();
  await database.schema
    .alterTable('site_widgets')
    .addUniqueConstraint('site_widgets_site_widget_key_unique', [
      'tenant_id',
      'site_id',
      'widget_key',
    ])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('site_widgets')
    .dropConstraint('site_widgets_site_widget_key_unique')
    .execute();
  await database.schema
    .alterTable('site_widgets')
    .addUniqueConstraint('site_widgets_widget_key_key', ['widget_key'])
    .execute();
}
