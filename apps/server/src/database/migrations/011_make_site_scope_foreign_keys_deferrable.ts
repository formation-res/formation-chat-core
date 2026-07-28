import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await replaceForeignKeys(database, 'deferrable initially immediate');
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await replaceForeignKeys(database, 'not deferrable');
}

async function replaceForeignKeys(database: Kysely<unknown>, deferrability: string): Promise<void> {
  await sql`
    alter table site_widgets
      drop constraint site_widgets_site_foreign,
      add constraint site_widgets_site_foreign
        foreign key (tenant_id, site_id)
        references sites (tenant_id, site_id)
        on delete cascade
        ${sql.raw(deferrability)};

    alter table principals
      drop constraint principals_tenant_site_foreign,
      add constraint principals_tenant_site_foreign
        foreign key (tenant_id, site_id)
        references sites (tenant_id, site_id)
        on delete restrict
        ${sql.raw(deferrability)};

    alter table browser_sessions
      drop constraint browser_sessions_principal_foreign,
      add constraint browser_sessions_principal_foreign
        foreign key (tenant_id, site_id, principal_id)
        references principals (tenant_id, site_id, principal_id)
        on delete cascade
        ${sql.raw(deferrability)};

    alter table conversations
      drop constraint conversations_principal_foreign,
      add constraint conversations_principal_foreign
        foreign key (tenant_id, site_id, principal_id)
        references principals (tenant_id, site_id, principal_id)
        on delete restrict
        ${sql.raw(deferrability)};

    alter table conversation_participants
      drop constraint conversation_participants_conversation_foreign,
      add constraint conversation_participants_conversation_foreign
        foreign key (tenant_id, site_id, conversation_id)
        references conversations (tenant_id, site_id, conversation_id)
        on delete cascade
        ${sql.raw(deferrability)};

    alter table messages
      drop constraint messages_participant_foreign,
      add constraint messages_participant_foreign
        foreign key (tenant_id, site_id, conversation_id, participant_id)
        references conversation_participants (tenant_id, site_id, conversation_id, participant_id)
        on delete restrict
        ${sql.raw(deferrability)};

    alter table conversation_events
      drop constraint conversation_events_conversation_foreign,
      add constraint conversation_events_conversation_foreign
        foreign key (tenant_id, site_id, conversation_id)
        references conversations (tenant_id, site_id, conversation_id)
        on delete cascade
        ${sql.raw(deferrability)};

    alter table agent_runs
      drop constraint agent_runs_conversation_foreign,
      add constraint agent_runs_conversation_foreign
        foreign key (tenant_id, site_id, conversation_id)
        references conversations (tenant_id, site_id, conversation_id)
        on delete cascade
        ${sql.raw(deferrability)};
  `.execute(database);
}
