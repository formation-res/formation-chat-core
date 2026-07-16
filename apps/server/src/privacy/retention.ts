import type { Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { DatabaseSchema } from '../database/types.js';

export interface RetentionPolicy {
  anonymousDays: number;
  authenticatedDays: number;
  contactValueHours: number;
}

export interface RetentionResult {
  conversationsDeleted: number;
  principalsDeleted: number;
  contactValuesRedacted: number;
}

export class RetentionService {
  constructor(
    private readonly database: Database,
    private readonly policy: RetentionPolicy,
  ) {}

  async runOnce(now = new Date()): Promise<RetentionResult> {
    const anonymousCutoff = new Date(
      now.getTime() - this.policy.anonymousDays * 24 * 60 * 60 * 1000,
    );
    const contactCutoff = new Date(now.getTime() - this.policy.contactValueHours * 60 * 60 * 1000);

    return this.database.transaction().execute(async (transaction) => {
      const redacted = await transaction
        .updateTable('structured_input_requests')
        .set({ value: null, status: 'expired' })
        .where('value', 'is not', null)
        .where('updated_at', '<', contactCutoff)
        .executeTakeFirst();

      const expired = await transaction
        .selectFrom('conversations')
        .innerJoin('principals', (join) =>
          join
            .onRef('principals.principal_id', '=', 'conversations.principal_id')
            .onRef('principals.tenant_id', '=', 'conversations.tenant_id')
            .onRef('principals.site_id', '=', 'conversations.site_id'),
        )
        .select([
          'conversations.conversation_id',
          'conversations.tenant_id',
          'conversations.site_id',
        ])
        .where('principals.kind', '=', 'anonymous')
        .where('conversations.updated_at', '<', anonymousCutoff)
        .limit(100)
        .execute();

      for (const conversation of expired) {
        await deleteConversation(transaction, conversation);
      }

      await transaction
        .deleteFrom('command_idempotency')
        .where('created_at', '<', anonymousCutoff)
        .execute();
      await transaction
        .deleteFrom('session_bootstrap_idempotency')
        .where('created_at', '<', anonymousCutoff)
        .execute();
      await transaction.deleteFrom('browser_sessions').where('expires_at', '<', now).execute();

      const candidates = await transaction
        .selectFrom('principals')
        .select(['principal_id', 'tenant_id', 'site_id'])
        .where('kind', '=', 'anonymous')
        .where('created_at', '<', anonymousCutoff)
        .limit(100)
        .execute();
      let principalsDeleted = 0;
      for (const principal of candidates) {
        const conversation = await transaction
          .selectFrom('conversations')
          .select('conversation_id')
          .where('tenant_id', '=', principal.tenant_id)
          .where('site_id', '=', principal.site_id)
          .where('principal_id', '=', principal.principal_id)
          .executeTakeFirst();
        if (conversation) continue;
        const deleted = await transaction
          .deleteFrom('principals')
          .where('tenant_id', '=', principal.tenant_id)
          .where('site_id', '=', principal.site_id)
          .where('principal_id', '=', principal.principal_id)
          .executeTakeFirst();
        principalsDeleted += Number(deleted.numDeletedRows);
      }

      return {
        conversationsDeleted: expired.length,
        principalsDeleted,
        contactValuesRedacted: Number(redacted.numUpdatedRows),
      };
    });
  }
}

async function deleteConversation(
  transaction: Transaction<DatabaseSchema>,
  scope: { conversation_id: string; tenant_id: string; site_id: string },
): Promise<void> {
  const ids = [scope.tenant_id, scope.site_id, scope.conversation_id] as const;
  await transaction
    .deleteFrom('structured_input_requests')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
  await transaction
    .deleteFrom('handoffs')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
  await transaction
    .deleteFrom('agent_runs')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
  await transaction
    .deleteFrom('conversation_events')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
  await transaction
    .deleteFrom('messages')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
  await transaction
    .deleteFrom('conversation_participants')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
  await transaction
    .deleteFrom('conversations')
    .where('tenant_id', '=', ids[0])
    .where('site_id', '=', ids[1])
    .where('conversation_id', '=', ids[2])
    .execute();
}

export class RetentionWorker {
  constructor(private readonly service: RetentionService) {}

  async run(signal: AbortSignal, intervalMs: number): Promise<void> {
    while (!signal.aborted) {
      await this.service.runOnce();
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, intervalMs);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}
