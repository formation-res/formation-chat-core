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

export interface PrincipalTable {
  principal_id: string;
  tenant_id: string;
  site_id: string;
  kind: 'anonymous';
  browser_identity: string;
  created_at: Generated<Date>;
}

export interface BrowserSessionTable {
  session_id: string;
  tenant_id: string;
  site_id: string;
  principal_id: string;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface SessionBootstrapIdempotencyTable {
  site_id: string;
  idempotency_key: string;
  request_hash: string;
  browser_identity: string;
  created_at: Generated<Date>;
}

export interface DatabaseSchema {
  tenants: TenantTable;
  sites: SiteTable;
  principals: PrincipalTable;
  browser_sessions: BrowserSessionTable;
  session_bootstrap_idempotency: SessionBootstrapIdempotencyTable;
}
