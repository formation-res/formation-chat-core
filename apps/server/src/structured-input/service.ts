import { createHash } from 'node:crypto';

import type {
  SessionTokenClaims,
  StructuredInputRequest,
  SubmitStructuredInputRequest,
} from '@formation-chat-core/protocol';
import { sql, type Selectable, type Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { DatabaseSchema, StructuredInputRequestTable } from '../database/types.js';

type InputScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'principalId'>;

export class StructuredInputApiError extends Error {
  constructor(
    readonly code:
      | 'CONVERSATION_NOT_FOUND'
      | 'INPUT_NOT_FOUND'
      | 'INPUT_ALREADY_RESOLVED'
      | 'IDEMPOTENCY_CONFLICT',
    readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'StructuredInputApiError';
  }
}

export class StructuredInputService {
  constructor(private readonly database: Database) {}

  async submit(
    scope: InputScope,
    conversationId: string,
    requestId: string,
    request: SubmitStructuredInputRequest,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<StructuredInputRequest> {
    const operation = `structured-input:submit:${conversationId}:${requestId}`;
    const requestHash = hashRequest(request);
    await this.database.transaction().execute(async (transaction) => {
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
          throw new StructuredInputApiError(
            'IDEMPOTENCY_CONFLICT',
            409,
            'The idempotency key was already used for a different request.',
          );
        }
        return;
      }

      const conversation = await transaction
        .selectFrom('conversations')
        .select('conversation_id')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('conversation_id', '=', conversationId)
        .executeTakeFirst();
      if (!conversation) {
        throw new StructuredInputApiError(
          'CONVERSATION_NOT_FOUND',
          404,
          'The conversation was not found.',
        );
      }
      const input = await transaction
        .selectFrom('structured_input_requests')
        .select(['request_id', 'run_id', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('conversation_id', '=', conversationId)
        .where('request_id', '=', requestId)
        .forUpdate()
        .executeTakeFirst();
      if (!input) {
        throw new StructuredInputApiError(
          'INPUT_NOT_FOUND',
          404,
          'The structured input request was not found.',
        );
      }
      if (input.status !== 'pending') {
        throw new StructuredInputApiError(
          'INPUT_ALREADY_RESOLVED',
          409,
          'The structured input request was already resolved.',
        );
      }

      const submitted = 'value' in request;
      const inputUpdate = await transaction
        .updateTable('structured_input_requests')
        .set({
          status: submitted ? 'submitted' : 'declined',
          value: submitted ? request.value : null,
          consent_status: submitted ? 'granted' : 'declined',
          consent_recorded_at: now,
          updated_at: now,
        })
        .where('request_id', '=', input.request_id)
        .executeTakeFirst();
      if (inputUpdate.numUpdatedRows !== 1n) {
        throw new StructuredInputApiError(
          'INPUT_ALREADY_RESOLVED',
          409,
          'The structured input request was already resolved.',
        );
      }
      const runUpdate = await transaction
        .updateTable('agent_runs')
        .set({
          status: 'queued',
          available_at: now,
          claimed_at: null,
          lease_expires_at: null,
          error_code: null,
          completed_at: null,
          updated_at: now,
        })
        .where('run_id', '=', input.run_id)
        .where('status', '=', 'waiting_for_input')
        .executeTakeFirst();
      if (runUpdate.numUpdatedRows !== 1n) {
        throw new StructuredInputApiError(
          'INPUT_ALREADY_RESOLVED',
          409,
          'The structured input request cannot be resolved in the current run state.',
        );
      }
      if (submitted) {
        await transaction
          .updateTable('handoffs')
          .set({ status: 'delivering', updated_at: now })
          .where('run_id', '=', input.run_id)
          .execute();
      }
      await transaction
        .insertInto('command_idempotency')
        .values({
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          principal_id: scope.principalId,
          operation,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          resource_id: input.request_id,
        })
        .execute();
    });
    return this.get(scope, conversationId, requestId);
  }

  private async get(
    scope: InputScope,
    conversationId: string,
    requestId: string,
  ): Promise<StructuredInputRequest> {
    const row = await this.database
      .selectFrom('structured_input_requests as input')
      .innerJoin('conversations as conversation', (join) =>
        join
          .onRef('conversation.tenant_id', '=', 'input.tenant_id')
          .onRef('conversation.site_id', '=', 'input.site_id')
          .onRef('conversation.conversation_id', '=', 'input.conversation_id'),
      )
      .selectAll('input')
      .where('input.tenant_id', '=', scope.tenantId)
      .where('input.site_id', '=', scope.siteId)
      .where('input.conversation_id', '=', conversationId)
      .where('input.request_id', '=', requestId)
      .where('conversation.principal_id', '=', scope.principalId)
      .executeTakeFirst();
    if (!row) {
      throw new StructuredInputApiError(
        'INPUT_NOT_FOUND',
        404,
        'The structured input request was not found.',
      );
    }
    return mapInput(row);
  }

  private async lockIdempotency(
    transaction: Transaction<DatabaseSchema>,
    scope: InputScope,
    operation: string,
    key: string,
  ): Promise<void> {
    const lockKey = `${scope.tenantId}:${scope.siteId}:${scope.principalId}:${operation}:${key}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(transaction);
  }
}

function hashRequest(request: SubmitStructuredInputRequest): string {
  const canonical = 'value' in request ? ['submitted', request.value] : ['declined'];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function mapInput(row: Selectable<StructuredInputRequestTable>): StructuredInputRequest {
  return {
    requestId: row.request_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    inputKind: row.input_kind,
    purpose: row.purpose,
    prompt: row.prompt,
    required: row.required,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
