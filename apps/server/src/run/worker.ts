import type { ConnectorEvent, ConnectorRunRequest, Message } from '@formation-chat-core/protocol';
import {
  validateConnectorEventContext,
  validateConnectorRunRequestContext,
} from '@formation-chat-core/protocol';
import type { ChatConnector } from '@formation-chat-core/server-sdk';
import { sql, type Selectable, type Transaction } from 'kysely';

import type { Database } from '../database/database.js';
import type { AgentRunTable, DatabaseSchema, MessageTable } from '../database/types.js';
import { EventService } from '../event/service.js';
import { isConnectorEvent } from './validation.js';

type ClaimedRun = Selectable<AgentRunTable>;
type ResolveConnector = (agentRef: string) => ChatConnector | undefined;

export class RunWorker {
  constructor(
    private readonly database: Database,
    private readonly events: EventService,
    private readonly resolveConnector: ResolveConnector,
    private readonly options: { leaseMs: number; maxAttempts: number },
  ) {
    if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs < 1) {
      throw new RangeError('leaseMs must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive safe integer.');
    }
  }

  async processNext(now = new Date()): Promise<boolean> {
    const run = await this.claim(now);
    if (!run) return false;
    const connector = this.resolveConnector(run.agent_ref);
    if (!connector) {
      await this.fail(run.run_id, 'CONNECTOR_NOT_FOUND', now);
      return true;
    }

    try {
      const context = await this.loadContext(run);
      for await (const event of connector.run({
        request: context.request,
        assistantMessageId: run.assistant_message_id,
        signal: new AbortController().signal,
      })) {
        if (
          !isConnectorEvent(event) ||
          !validateConnectorEventContext(event, {
            conversationId: run.conversation_id,
            runId: run.run_id,
            assistantMessageId: run.assistant_message_id,
          })
        ) {
          await this.fail(run.run_id, 'INVALID_CONNECTOR_EVENT', now);
          return true;
        }
        await this.materialize(run, context.assistantParticipantId, event, now);
        await this.events.append(context.scope, event);
        if (event.type === 'run.completed') {
          await this.complete(run.run_id, now);
          return true;
        }
        if (event.type === 'run.failed') {
          await this.fail(run.run_id, event.data.code, now);
          return true;
        }
      }
      await this.fail(run.run_id, 'CONNECTOR_INCOMPLETE', now);
    } catch {
      await this.fail(run.run_id, 'CONNECTOR_EXECUTION_FAILED', now);
    }
    return true;
  }

  private claim(now: Date): Promise<ClaimedRun | undefined> {
    return this.database.transaction().execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom('agent_runs')
        .selectAll()
        .where('available_at', '<=', now)
        .where('attempt', '<', this.options.maxAttempts)
        .where((expression) =>
          expression.or([
            expression('status', '=', 'queued'),
            expression.and([
              expression('status', '=', 'running'),
              expression('lease_expires_at', '<=', now),
            ]),
          ]),
        )
        .orderBy('available_at')
        .orderBy('created_at')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return undefined;
      return transaction
        .updateTable('agent_runs')
        .set({
          status: 'running',
          attempt: sql<number>`attempt + 1`,
          claimed_at: now,
          lease_expires_at: new Date(now.getTime() + this.options.leaseMs),
          updated_at: now,
        })
        .where('run_id', '=', candidate.run_id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  private async loadContext(run: ClaimedRun) {
    const currentMessage = await this.database
      .selectFrom('messages')
      .selectAll()
      .where('tenant_id', '=', run.tenant_id)
      .where('site_id', '=', run.site_id)
      .where('conversation_id', '=', run.conversation_id)
      .where('message_id', '=', run.trigger_message_id)
      .executeTakeFirstOrThrow();
    const [conversation, historyDescending, participants] = await Promise.all([
      this.database
        .selectFrom('conversations')
        .select(['principal_id', 'agent_ref'])
        .where('tenant_id', '=', run.tenant_id)
        .where('site_id', '=', run.site_id)
        .where('conversation_id', '=', run.conversation_id)
        .executeTakeFirstOrThrow(),
      this.database
        .selectFrom('messages')
        .selectAll()
        .where('tenant_id', '=', run.tenant_id)
        .where('site_id', '=', run.site_id)
        .where('conversation_id', '=', run.conversation_id)
        .where('sequence', '<=', currentMessage.sequence)
        .orderBy('sequence', 'desc')
        .limit(1000)
        .execute(),
      this.database
        .selectFrom('conversation_participants')
        .select(['participant_id', 'kind'])
        .where('tenant_id', '=', run.tenant_id)
        .where('site_id', '=', run.site_id)
        .where('conversation_id', '=', run.conversation_id)
        .execute(),
    ]);
    const principalRow = await this.database
      .selectFrom('principals')
      .select(['principal_id', 'kind'])
      .where('tenant_id', '=', run.tenant_id)
      .where('site_id', '=', run.site_id)
      .where('principal_id', '=', conversation.principal_id)
      .executeTakeFirstOrThrow();
    const userParticipantId = participants.find(({ kind }) => kind === 'user')?.participant_id;
    const assistantParticipantId = participants.find(
      ({ kind }) => kind === 'agent',
    )?.participant_id;
    if (!userParticipantId || !assistantParticipantId) throw new Error('Run participants missing.');
    const request: ConnectorRunRequest = {
      runId: run.run_id,
      conversationId: run.conversation_id,
      agentRef: conversation.agent_ref,
      currentMessage: toMessage(currentMessage) as ConnectorRunRequest['currentMessage'],
      userParticipantId,
      history: historyDescending.reverse().map(toMessage),
      principalContext: { kind: principalRow.kind, principalId: principalRow.principal_id },
      trustedMetadata: {},
    };
    if (
      !validateConnectorRunRequestContext(request, {
        conversationId: run.conversation_id,
        runId: run.run_id,
        agentRef: run.agent_ref,
        userParticipantId,
        currentMessageId: run.trigger_message_id,
      })
    ) {
      throw new Error('Connector run context is inconsistent.');
    }
    return {
      request,
      assistantParticipantId,
      scope: {
        tenantId: run.tenant_id,
        siteId: run.site_id,
        principalId: conversation.principal_id,
      },
    };
  }

  private async materialize(
    run: ClaimedRun,
    participantId: string,
    event: ConnectorEvent,
    now: Date,
  ): Promise<void> {
    if (event.type === 'message.started') {
      await this.database.transaction().execute(async (transaction) => {
        const exists = await transaction
          .selectFrom('messages')
          .select('message_id')
          .where('message_id', '=', run.assistant_message_id)
          .executeTakeFirst();
        if (exists) return;
        const sequence = await transaction
          .updateTable('conversations')
          .set({ next_message_sequence: sql<number>`next_message_sequence + 1`, updated_at: now })
          .where('tenant_id', '=', run.tenant_id)
          .where('site_id', '=', run.site_id)
          .where('conversation_id', '=', run.conversation_id)
          .returning('next_message_sequence')
          .executeTakeFirstOrThrow();
        await this.insertAssistant(
          transaction,
          run,
          participantId,
          sequence.next_message_sequence - 1,
          now,
        );
      });
    }
    if (event.type === 'message.completed') {
      const result = await this.database
        .updateTable('messages')
        .set({ status: 'completed', parts: JSON.stringify(event.data.parts), completed_at: now })
        .where('tenant_id', '=', run.tenant_id)
        .where('site_id', '=', run.site_id)
        .where('conversation_id', '=', run.conversation_id)
        .where('message_id', '=', run.assistant_message_id)
        .execute();
      if (result[0]?.numUpdatedRows !== 1n) throw new Error('Assistant message was not started.');
    }
  }

  private insertAssistant(
    transaction: Transaction<DatabaseSchema>,
    run: ClaimedRun,
    participantId: string,
    sequence: number,
    now: Date,
  ) {
    return transaction
      .insertInto('messages')
      .values({
        message_id: run.assistant_message_id,
        tenant_id: run.tenant_id,
        site_id: run.site_id,
        conversation_id: run.conversation_id,
        sequence,
        participant_id: participantId,
        role: 'assistant',
        status: 'streaming',
        parts: JSON.stringify([]),
        created_at: now,
        completed_at: null,
      })
      .execute();
  }

  private complete(runId: string, now: Date) {
    return this.database
      .updateTable('agent_runs')
      .set({ status: 'completed', completed_at: now, lease_expires_at: null, updated_at: now })
      .where('run_id', '=', runId)
      .execute();
  }

  private fail(runId: string, code: string, now: Date) {
    return this.database
      .updateTable('agent_runs')
      .set({
        status: 'failed',
        error_code: code,
        completed_at: now,
        lease_expires_at: null,
        updated_at: now,
      })
      .where('run_id', '=', runId)
      .execute();
  }
}

function toMessage(row: Selectable<MessageTable>): Message {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    participantId: row.participant_id,
    role: row.role,
    status: row.status,
    parts: row.parts,
    createdAt: row.created_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}
