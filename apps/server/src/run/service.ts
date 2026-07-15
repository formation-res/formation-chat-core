import { createHash } from 'node:crypto';

import type { CancelRunResponse, SessionTokenClaims } from '@formation-chat-core/protocol';
import { sql, type Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { DatabaseSchema } from '../database/types.js';
import type { RunCancellationCoordinator } from './cancellation.js';

type RunScope = Pick<SessionTokenClaims, 'tenantId' | 'siteId' | 'principalId'>;

export class RunApiError extends Error {
  constructor(
    readonly code: 'CONVERSATION_NOT_FOUND' | 'RUN_NOT_FOUND',
    readonly statusCode: 404,
    message: string,
  ) {
    super(message);
    this.name = 'RunApiError';
  }
}

export class RunService {
  constructor(
    private readonly database: Database,
    private readonly cancellation?: RunCancellationCoordinator,
  ) {}

  async cancel(
    scope: RunScope,
    conversationId: string,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<CancelRunResponse> {
    const operation = `run:cancel:${conversationId}`;
    const requestHash = createHash('sha256').update('{}').digest('hex');
    const result = await this.database.transaction().execute(async (transaction) => {
      await this.lockIdempotency(transaction, scope, operation, idempotencyKey);
      const previous = await transaction
        .selectFrom('command_idempotency')
        .select('resource_id')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('operation', '=', operation)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      if (previous) return decodeOutcome(conversationId, previous.resource_id);

      const conversation = await transaction
        .selectFrom('conversations')
        .select('conversation_id')
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('principal_id', '=', scope.principalId)
        .where('conversation_id', '=', conversationId)
        .executeTakeFirst();
      if (!conversation) {
        throw new RunApiError('CONVERSATION_NOT_FOUND', 404, 'The conversation was not found.');
      }
      const run = await transaction
        .selectFrom('agent_runs')
        .select(['run_id', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('site_id', '=', scope.siteId)
        .where('conversation_id', '=', conversationId)
        .orderBy('created_at', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (!run) throw new RunApiError('RUN_NOT_FOUND', 404, 'No run was found to cancel.');

      let cancellationStatus: CancelRunResponse['cancellationStatus'];
      if (run.status === 'queued') {
        cancellationStatus = 'cancelled';
        await transaction
          .updateTable('agent_runs')
          .set({
            status: 'cancelled',
            cancel_requested_at: now,
            completed_at: now,
            updated_at: now,
          })
          .where('run_id', '=', run.run_id)
          .execute();
      } else if (run.status === 'running' || run.status === 'cancel_requested') {
        cancellationStatus = 'cancel_requested';
        await transaction
          .updateTable('agent_runs')
          .set({ status: 'cancel_requested', cancel_requested_at: now, updated_at: now })
          .where('run_id', '=', run.run_id)
          .execute();
      } else {
        cancellationStatus = 'already_finished';
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
          resource_id: `${run.run_id}|${cancellationStatus}`,
        })
        .execute();
      return { conversationId, runId: run.run_id, cancellationStatus };
    });
    if (result.cancellationStatus === 'cancel_requested') {
      await this.cancellation?.request(result.runId);
    }
    return result;
  }

  private async lockIdempotency(
    transaction: Transaction<DatabaseSchema>,
    scope: RunScope,
    operation: string,
    key: string,
  ): Promise<void> {
    const lockKey = `${scope.tenantId}:${scope.siteId}:${scope.principalId}:${operation}:${key}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(transaction);
  }
}

function decodeOutcome(conversationId: string, resourceId: string): CancelRunResponse {
  const separator = resourceId.lastIndexOf('|');
  const runId = resourceId.slice(0, separator);
  const cancellationStatus = resourceId.slice(
    separator + 1,
  ) as CancelRunResponse['cancellationStatus'];
  if (
    !runId ||
    !['cancel_requested', 'cancelled', 'already_finished'].includes(cancellationStatus)
  ) {
    throw new Error('Stored cancellation outcome is invalid.');
  }
  return { conversationId, runId, cancellationStatus };
}
