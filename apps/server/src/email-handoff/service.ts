import { createHash, randomUUID } from 'node:crypto';

import type {
  CreateEmailHandoffRequest,
  CreateEmailHandoffResponse,
  SessionTokenClaims,
} from '@formation-chat-core/protocol';
import { sql, type Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { DatabaseSchema } from '../database/types.js';

type EmailHandoffScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'principalId'>;

export class EmailHandoffApiError extends Error {
  constructor(
    readonly code: 'CONVERSATION_NOT_FOUND' | 'EMPTY_CONVERSATION' | 'IDEMPOTENCY_CONFLICT',
    readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'EmailHandoffApiError';
  }
}

export class EmailHandoffService {
  constructor(private readonly database: Database) {}

  async create(
    scope: EmailHandoffScope,
    conversationId: string,
    request: CreateEmailHandoffRequest,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<CreateEmailHandoffResponse> {
    const operation = `email-handoff:create:${conversationId}`;
    const email = request.email.trim().toLowerCase();
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ email, consent: request.consent }))
      .digest('hex');
    const handoffId = await this.database.transaction().execute(async (transaction) => {
      await this.lockIdempotency(transaction, scope, operation, idempotencyKey);
      const previous = await transaction
        .selectFrom('command_idempotency')
        .select(['request_hash', 'resource_id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('operation', '=', operation)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new EmailHandoffApiError(
            'IDEMPOTENCY_CONFLICT',
            409,
            'The idempotency key was already used for a different request.',
          );
        }
        return previous.resource_id;
      }

      const conversation = await transaction
        .selectFrom('conversations')
        .select(['agent_ref'])
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('conversation_id', '=', conversationId)
        .executeTakeFirst();
      if (!conversation) {
        throw new EmailHandoffApiError(
          'CONVERSATION_NOT_FOUND',
          404,
          'The conversation was not found.',
        );
      }
      const trigger = await transaction
        .selectFrom('messages')
        .select('message_id')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('conversation_id', '=', conversationId)
        .where('role', '=', 'user')
        .where('status', '=', 'completed')
        .orderBy('sequence', 'desc')
        .executeTakeFirst();
      if (!trigger) {
        throw new EmailHandoffApiError(
          'EMPTY_CONVERSATION',
          400,
          'Send a chat message before continuing by email.',
        );
      }

      const runId = randomUUID();
      const id = randomUUID();
      await transaction
        .insertInto('agent_runs')
        .values({
          run_id: runId,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          conversation_id: conversationId,
          trigger_message_id: trigger.message_id,
          trigger_type: 'agent_email_handoff',
          assistant_message_id: randomUUID(),
          agent_ref: conversation.agent_ref,
          status: 'queued',
        })
        .execute();
      await transaction
        .insertInto('handoffs')
        .values({
          handoff_id: id,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          conversation_id: conversationId,
          run_id: runId,
          kind: 'agent_email',
          status: 'delivering',
          created_at: now,
          updated_at: now,
        })
        .execute();
      await transaction
        .insertInto('structured_input_requests')
        .values({
          request_id: id,
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          conversation_id: conversationId,
          run_id: runId,
          input_kind: 'email',
          purpose: 'agent_email_handoff',
          prompt: 'Email me this conversation',
          required: true,
          status: 'submitted',
          value: email,
          consent_status: 'granted',
          consent_recorded_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await transaction
        .insertInto('command_idempotency')
        .values({
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          principal_id: scope.principalId,
          operation,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          resource_id: id,
        })
        .execute();
      return id;
    });
    return this.get(scope, conversationId, handoffId);
  }

  private async get(
    scope: EmailHandoffScope,
    conversationId: string,
    handoffId: string,
  ): Promise<CreateEmailHandoffResponse> {
    const row = await this.database
      .selectFrom('handoffs')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', scope.siteId)
      .where('conversation_id', '=', conversationId)
      .where('handoff_id', '=', handoffId)
      .where('kind', '=', 'agent_email')
      .executeTakeFirstOrThrow();
    return {
      handoffId: row.handoff_id,
      conversationId: row.conversation_id,
      runId: row.run_id,
      kind: 'agent_email',
      status: row.status === 'completed' || row.status === 'failed' ? row.status : 'delivering',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async lockIdempotency(
    transaction: Transaction<DatabaseSchema>,
    scope: EmailHandoffScope,
    operation: string,
    key: string,
  ): Promise<void> {
    const lockKey = `${scope.tenantId}:${scope.siteId}:${scope.principalId}:${operation}:${key}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(transaction);
  }
}
