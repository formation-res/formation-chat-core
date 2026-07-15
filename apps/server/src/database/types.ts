import type { Generated, JSONColumnType } from 'kysely';

export interface TenantTable {
  tenant_id: string;
  display_name: string;
  created_at: Generated<Date>;
}

export interface SiteTable {
  site_id: string;
  tenant_id: string;
  site_key: string;
  display_name: string;
  allowed_origins: JSONColumnType<string[]>;
  agent_ref: string;
  created_at: Generated<Date>;
}

export interface DatabaseSchema {
  tenants: TenantTable;
  sites: SiteTable;
}
