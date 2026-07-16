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
}
