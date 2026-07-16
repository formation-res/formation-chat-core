import type { FastifyRequest } from 'fastify';

import type { Database } from '../database/database.js';

export interface AuditActor {
  actorKind: 'anonymous' | 'admin' | 'system';
  actorId?: string;
  tenantId?: string;
  siteId?: string;
}

export interface AuditEvent extends AuditActor {
  correlationId: string;
  action: string;
  outcome: 'success' | 'denied' | 'failure';
  statusCode: number;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

const actors = new WeakMap<FastifyRequest, AuditActor>();

export function setAuditActor(request: FastifyRequest, actor: AuditActor): void {
  actors.set(request, actor);
}

export function getAuditActor(request: FastifyRequest): AuditActor {
  return actors.get(request) ?? { actorKind: 'system' };
}

export class DatabaseAuditSink implements AuditSink {
  constructor(private readonly database: Database) {}

  async record(event: AuditEvent): Promise<void> {
    await this.database
      .insertInto('audit_events')
      .values({
        correlation_id: event.correlationId,
        actor_kind: event.actorKind,
        actor_id: event.actorId ?? null,
        tenant_id: event.tenantId ?? null,
        site_id: event.siteId ?? null,
        action: event.action,
        outcome: event.outcome,
        status_code: event.statusCode,
      })
      .execute();
  }
}
