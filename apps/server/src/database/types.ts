import type { ContentPart } from '@formation-chat-core/protocol';
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

export interface ConversationTable {
  conversation_id: string;
  tenant_id: string;
  site_id: string;
  principal_id: string;
  agent_ref: string;
  status: 'active' | 'completed' | 'cancelled';
  next_message_sequence: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConversationParticipantTable {
  participant_id: string;
  tenant_id: string;
  site_id: string;
  conversation_id: string;
  kind: 'user' | 'agent';
  principal_id: string | null;
  agent_ref: string | null;
  created_at: Generated<Date>;
}

export interface MessageTable {
  message_id: string;
  tenant_id: string;
  site_id: string;
  conversation_id: string;
  sequence: number;
  participant_id: string;
  role: 'user' | 'assistant' | 'system';
  status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  parts: JSONColumnType<ContentPart[]>;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface CommandIdempotencyTable {
  tenant_id: string;
  site_id: string;
  principal_id: string;
  operation: string;
  idempotency_key: string;
  request_hash: string;
  resource_id: string;
  created_at: Generated<Date>;
}

export interface DatabaseSchema {
  tenants: TenantTable;
  sites: SiteTable;
  principals: PrincipalTable;
  browser_sessions: BrowserSessionTable;
  session_bootstrap_idempotency: SessionBootstrapIdempotencyTable;
  conversations: ConversationTable;
  conversation_participants: ConversationParticipantTable;
  messages: MessageTable;
  command_idempotency: CommandIdempotencyTable;
}
