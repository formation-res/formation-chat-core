/**
 * @typedef {{ query(text: string, values?: unknown[]): Promise<unknown> }} Queryable
 * @typedef {{ agentRef: string, origin: string, siteId: string, siteKey: string, tenantId: string }} SiteConfig
 */

/** @param {Queryable} database @param {SiteConfig} config */
export async function provisionLocalChatSite(database, config) {
  await database.query(
    `insert into tenants (tenant_id, display_name)
     values ($1, $2)
     on conflict (tenant_id) do update set display_name = excluded.display_name`,
    [config.tenantId, 'Local development'],
  );
  await database.query(
    `insert into sites
       (site_id, tenant_id, site_key, display_name, allowed_origins, agent_ref)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     on conflict (site_key) do update set
       tenant_id = excluded.tenant_id,
       display_name = excluded.display_name,
       allowed_origins = excluded.allowed_origins,
       agent_ref = excluded.agent_ref`,
    [
      config.siteId,
      config.tenantId,
      config.siteKey,
      'Local chat',
      JSON.stringify([config.origin]),
      config.agentRef,
    ],
  );
  await database.query(
    `insert into site_widgets
       (widget_id, tenant_id, site_id, widget_key, display_name, version, theme, launcher,
        placement, default_agent_alias, agent_aliases)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     on conflict (widget_key) do update set
       tenant_id = excluded.tenant_id,
       site_id = excluded.site_id,
       display_name = excluded.display_name,
       version = excluded.version,
       theme = excluded.theme,
       launcher = excluded.launcher,
       placement = excluded.placement,
       default_agent_alias = excluded.default_agent_alias,
       agent_aliases = excluded.agent_aliases,
       updated_at = now()`,
    [
      'local-main-widget',
      config.tenantId,
      config.siteId,
      'main-chat',
      'Main chat',
      '2026-07-23',
      'earth',
      'agent',
      'bottom-right',
      'support',
      JSON.stringify([{ alias: 'support', label: 'Support', agentRef: config.agentRef }]),
    ],
  );
}
