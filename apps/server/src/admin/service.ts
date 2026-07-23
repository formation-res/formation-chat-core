import type {
  AdminConversationFilter,
  AdminConversationList,
  AdminEventList,
  AdminFailureList,
  AdminHandoffFilter,
  AdminHandoffList,
  AdminMessageList,
  AdminOverview,
  AdminRunFilter,
  AdminRunList,
  AdminTokenClaims,
  Conversation,
  ConversationEvent,
  Message,
} from '@formation-chat-core/protocol';
import type { Selectable } from 'kysely';

import type { Database } from '../database/database.js';
import type {
  ConversationEventTable,
  ConversationParticipantTable,
  ConversationTable,
  AgentRunTable,
  HandoffTable,
  MessageTable,
  SiteTable,
  SiteWidgetTable,
} from '../database/types.js';
import {
  decodeSequenceCursor,
  decodeTimeCursor,
  encodeSequenceCursor,
  encodeTimeCursor,
} from './cursor.js';

type AdminScope = Pick<AdminTokenClaims, 'tenantId' | 'siteIds' | 'scopes'>;

export class AdminApiError extends Error {
  constructor(
    readonly code: 'FORBIDDEN_SITE' | 'INVALID_CURSOR' | 'INVALID_DATE_RANGE' | 'NOT_FOUND',
    readonly statusCode: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export class AdminQueryService {
  constructor(private readonly database: Database) {}

  async getOverview(scope: AdminScope): Promise<AdminOverview> {
    const tenant = await this.database
      .selectFrom('tenants')
      .select(['tenant_id', 'display_name'])
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!tenant) throw new AdminApiError('NOT_FOUND', 404, 'The resource was not found.');

    const siteRows = await this.database
      .selectFrom('sites')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .orderBy('display_name')
      .orderBy('site_id')
      .execute();

    const sites = await Promise.all(siteRows.map((site) => this.siteOverview(scope, site)));
    const totals = sites.reduce(
      (sum, site) => ({
        conversations: sum.conversations + site.stats.conversations,
        activeConversations: sum.activeConversations + site.stats.activeConversations,
        runs: sum.runs + site.stats.runs,
        failures: sum.failures + site.stats.failures,
        handoffs: sum.handoffs + site.stats.handoffs,
      }),
      { conversations: 0, activeConversations: 0, runs: 0, failures: 0, handoffs: 0 },
    );

    return {
      tenant: { tenantId: tenant.tenant_id, displayName: tenant.display_name },
      sites,
      totals,
    };
  }

  async listConversations(
    scope: AdminScope,
    filter: AdminConversationFilter & { limit: number },
  ): Promise<AdminConversationList> {
    this.validateFilter(scope, filter);
    const cursor = filter.cursor ? decodeTimeCursor('conversation', filter.cursor) : undefined;
    if (filter.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('conversations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds);
    if (filter.siteId) query = query.where('site_id', '=', filter.siteId);
    if (filter.agentRef) query = query.where('agent_ref', '=', filter.agentRef);
    if (filter.status) query = query.where('status', '=', filter.status);
    if (filter.createdAfter) query = query.where('created_at', '>=', new Date(filter.createdAfter));
    if (filter.createdBefore)
      query = query.where('created_at', '<', new Date(filter.createdBefore));
    if (cursor) {
      const timestamp = new Date(cursor.timestamp);
      query = query.where((expression) =>
        expression.or([
          expression('created_at', '<', timestamp),
          expression.and([
            expression('created_at', '=', timestamp),
            expression('conversation_id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('conversation_id', 'desc')
      .limit(filter.limit + 1)
      .execute();
    const page = rows.slice(0, filter.limit);
    const participants = await this.participantsFor(
      scope,
      page.map(({ conversation_id }) => conversation_id),
    );
    const data = page.map((row) =>
      mapConversation(row, participants.get(row.conversation_id) ?? []),
    );
    const tail = page.at(-1);
    return {
      data,
      pagination:
        rows.length > filter.limit && tail
          ? {
              hasMore: true,
              nextCursor: encodeTimeCursor('conversation', tail.created_at, tail.conversation_id),
            }
          : { hasMore: false },
    };
  }

  async getConversation(scope: AdminScope, conversationId: string): Promise<Conversation> {
    const row = await this.scopedConversation(scope, conversationId);
    const participants = await this.participantsFor(scope, [conversationId]);
    return mapConversation(row, participants.get(conversationId) ?? []);
  }

  async listMessages(
    scope: AdminScope,
    conversationId: string,
    request: { cursor?: string; limit: number },
  ): Promise<AdminMessageList> {
    await this.scopedConversation(scope, conversationId);
    const cursor = request.cursor ? decodeSequenceCursor('message', request.cursor) : undefined;
    if (request.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('messages')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', '=', conversationId);
    if (cursor) query = query.where('sequence', '>', cursor);
    const rows = await query
      .orderBy('sequence')
      .limit(request.limit + 1)
      .execute();
    const page = rows.slice(0, request.limit);
    const tail = page.at(-1);
    return {
      data: page.map(mapMessage),
      pagination:
        rows.length > request.limit && tail
          ? { hasMore: true, nextCursor: encodeSequenceCursor('message', tail.sequence) }
          : { hasMore: false },
    };
  }

  async listEvents(
    scope: AdminScope,
    conversationId: string,
    request: { cursor?: string; limit: number },
  ): Promise<AdminEventList> {
    await this.scopedConversation(scope, conversationId);
    const cursor = request.cursor ? decodeSequenceCursor('event', request.cursor) : undefined;
    if (request.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('conversation_events')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', '=', conversationId);
    if (!scope.scopes.includes('admin:internal')) {
      query = query.where('visibility', 'in', ['public', 'operator']);
    }
    if (cursor) query = query.where('sequence', '>', cursor);
    const rows = await query
      .orderBy('sequence')
      .limit(request.limit + 1)
      .execute();
    const page = rows.slice(0, request.limit);
    const tail = page.at(-1);
    return {
      data: page.map(mapEvent),
      pagination:
        rows.length > request.limit && tail
          ? { hasMore: true, nextCursor: encodeSequenceCursor('event', tail.sequence) }
          : { hasMore: false },
    };
  }

  async listRuns(
    scope: AdminScope,
    filter: AdminRunFilter & { limit: number },
  ): Promise<AdminRunList> {
    this.validateFilter(scope, filter);
    const cursor = filter.cursor ? decodeTimeCursor('run', filter.cursor) : undefined;
    if (filter.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('agent_runs')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds);
    if (filter.siteId) query = query.where('site_id', '=', filter.siteId);
    if (filter.agentRef) query = query.where('agent_ref', '=', filter.agentRef);
    if (filter.status) query = query.where('status', '=', filter.status);
    if (filter.createdAfter) query = query.where('created_at', '>=', new Date(filter.createdAfter));
    if (filter.createdBefore)
      query = query.where('created_at', '<', new Date(filter.createdBefore));
    if (cursor) {
      const timestamp = new Date(cursor.timestamp);
      query = query.where((expression) =>
        expression.or([
          expression('created_at', '<', timestamp),
          expression.and([
            expression('created_at', '=', timestamp),
            expression('run_id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('run_id', 'desc')
      .limit(filter.limit + 1)
      .execute();
    const page = rows.slice(0, filter.limit);
    const tail = page.at(-1);
    return {
      data: page.map(mapRun),
      pagination:
        rows.length > filter.limit && tail
          ? { hasMore: true, nextCursor: encodeTimeCursor('run', tail.created_at, tail.run_id) }
          : { hasMore: false },
    };
  }

  async listFailures(
    scope: AdminScope,
    filter: Omit<AdminRunFilter, 'status'> & { limit: number },
  ): Promise<AdminFailureList> {
    this.validateFilter(scope, filter);
    const cursor = filter.cursor ? decodeTimeCursor('failure', filter.cursor) : undefined;
    if (filter.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('agent_runs')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('status', '=', 'failed');
    if (filter.siteId) query = query.where('site_id', '=', filter.siteId);
    if (filter.agentRef) query = query.where('agent_ref', '=', filter.agentRef);
    if (filter.createdAfter) query = query.where('created_at', '>=', new Date(filter.createdAfter));
    if (filter.createdBefore)
      query = query.where('created_at', '<', new Date(filter.createdBefore));
    if (cursor) {
      const timestamp = new Date(cursor.timestamp);
      query = query.where((expression) =>
        expression.or([
          expression('created_at', '<', timestamp),
          expression.and([
            expression('created_at', '=', timestamp),
            expression('run_id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('run_id', 'desc')
      .limit(filter.limit + 1)
      .execute();
    const page = rows.slice(0, filter.limit);
    const tail = page.at(-1);
    return {
      data: page.map((row) => ({
        ...mapRun(row),
        status: 'failed',
        errorCode: row.error_code ?? 'RUN_FAILED',
      })),
      pagination:
        rows.length > filter.limit && tail
          ? {
              hasMore: true,
              nextCursor: encodeTimeCursor('failure', tail.created_at, tail.run_id),
            }
          : { hasMore: false },
    };
  }

  async listHandoffs(
    scope: AdminScope,
    filter: AdminHandoffFilter & { limit: number },
  ): Promise<AdminHandoffList> {
    this.validateFilter(scope, filter);
    const cursor = filter.cursor ? decodeTimeCursor('handoff', filter.cursor) : undefined;
    if (filter.cursor && !cursor) throw this.invalidCursor();
    let query = this.database
      .selectFrom('handoffs as handoff')
      .innerJoin('agent_runs as run', 'run.run_id', 'handoff.run_id')
      .selectAll('handoff')
      .where('handoff.tenant_id', '=', scope.tenantId)
      .where('handoff.site_id', 'in', scope.siteIds);
    if (filter.siteId) query = query.where('handoff.site_id', '=', filter.siteId);
    if (filter.agentRef) query = query.where('run.agent_ref', '=', filter.agentRef);
    if (filter.status) query = query.where('handoff.status', '=', filter.status);
    if (filter.createdAfter)
      query = query.where('handoff.created_at', '>=', new Date(filter.createdAfter));
    if (filter.createdBefore)
      query = query.where('handoff.created_at', '<', new Date(filter.createdBefore));
    if (cursor) {
      const timestamp = new Date(cursor.timestamp);
      query = query.where((expression) =>
        expression.or([
          expression('handoff.created_at', '<', timestamp),
          expression.and([
            expression('handoff.created_at', '=', timestamp),
            expression('handoff.handoff_id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('handoff.created_at', 'desc')
      .orderBy('handoff.handoff_id', 'desc')
      .limit(filter.limit + 1)
      .execute();
    const page = rows.slice(0, filter.limit);
    const tail = page.at(-1);
    return {
      data: page.map(mapHandoff),
      pagination:
        rows.length > filter.limit && tail
          ? {
              hasMore: true,
              nextCursor: encodeTimeCursor('handoff', tail.created_at, tail.handoff_id),
            }
          : { hasMore: false },
    };
  }

  private validateFilter(
    scope: AdminScope,
    filter: Pick<AdminConversationFilter, 'siteId' | 'createdAfter' | 'createdBefore'>,
  ): void {
    if (filter.siteId && !scope.siteIds.includes(filter.siteId)) {
      throw new AdminApiError('FORBIDDEN_SITE', 403, 'The token does not allow this site.');
    }
    if (
      filter.createdAfter &&
      filter.createdBefore &&
      Date.parse(filter.createdAfter) >= Date.parse(filter.createdBefore)
    ) {
      throw new AdminApiError(
        'INVALID_DATE_RANGE',
        400,
        'createdAfter must be earlier than createdBefore.',
      );
    }
  }

  private async scopedConversation(scope: AdminScope, conversationId: string) {
    const row = await this.database
      .selectFrom('conversations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', '=', conversationId)
      .executeTakeFirst();
    if (!row) throw new AdminApiError('NOT_FOUND', 404, 'The resource was not found.');
    return row;
  }

  private async siteOverview(scope: AdminScope, site: Selectable<SiteTable>) {
    const [conversations, activeConversations, runs, failures, handoffs, widgets] =
      await Promise.all([
        this.countRows('conversations', scope, site.site_id),
        this.countActiveConversations(scope, site.site_id),
        this.countRows('agent_runs', scope, site.site_id),
        this.countFailedRuns(scope, site.site_id),
        this.countRows('handoffs', scope, site.site_id),
        this.widgetsForSite(scope, site.site_id),
      ]);
    const recentDates = await Promise.all([
      this.latestDate('conversations', scope, site.site_id, 'updated_at'),
      this.latestDate('agent_runs', scope, site.site_id, 'updated_at'),
      this.latestDate('handoffs', scope, site.site_id, 'updated_at'),
    ]);
    const recentActivity = recentDates
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];

    return {
      siteId: site.site_id,
      displayName: site.display_name,
      siteKey: site.site_key,
      allowedOrigins: normalizeOrigins(site.allowed_origins),
      agentRef: site.agent_ref,
      widgets,
      stats: { conversations, activeConversations, runs, failures, handoffs },
      ...(recentActivity ? { recentActivityAt: recentActivity.toISOString() } : {}),
    };
  }

  private async widgetsForSite(scope: AdminScope, siteId: string) {
    const rows = await this.database
      .selectFrom('site_widgets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', siteId)
      .orderBy('display_name')
      .orderBy('widget_id')
      .execute();
    return rows.map(mapSiteWidget);
  }

  private async countRows(
    table: 'conversations' | 'agent_runs' | 'handoffs',
    scope: AdminScope,
    siteId: string,
  ): Promise<number> {
    const row = await this.database
      .selectFrom(table)
      .select((expression) => expression.fn.countAll().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', siteId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async countActiveConversations(scope: AdminScope, siteId: string): Promise<number> {
    const row = await this.database
      .selectFrom('conversations')
      .select((expression) => expression.fn.countAll().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', siteId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async countFailedRuns(scope: AdminScope, siteId: string): Promise<number> {
    const row = await this.database
      .selectFrom('agent_runs')
      .select((expression) => expression.fn.countAll().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', siteId)
      .where('status', '=', 'failed')
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async latestDate(
    table: 'conversations' | 'agent_runs' | 'handoffs',
    scope: AdminScope,
    siteId: string,
    column: 'updated_at',
  ): Promise<Date | undefined> {
    const row = await this.database
      .selectFrom(table)
      .select((expression) => expression.fn.max<Date>(column).as('latest'))
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', '=', siteId)
      .executeTakeFirst();
    return row?.latest ?? undefined;
  }

  private async participantsFor(scope: AdminScope, conversationIds: string[]) {
    const grouped = new Map<string, Selectable<ConversationParticipantTable>[]>();
    if (conversationIds.length === 0) return grouped;
    const rows = await this.database
      .selectFrom('conversation_participants')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('site_id', 'in', scope.siteIds)
      .where('conversation_id', 'in', conversationIds)
      .orderBy('created_at')
      .execute();
    for (const row of rows) {
      const group = grouped.get(row.conversation_id) ?? [];
      group.push(row);
      grouped.set(row.conversation_id, group);
    }
    return grouped;
  }

  private invalidCursor() {
    return new AdminApiError('INVALID_CURSOR', 400, 'The cursor is invalid.');
  }
}

function normalizeOrigins(value: string[] | string): string[] {
  return Array.isArray(value) ? value : (JSON.parse(value) as string[]);
}

function normalizeAgentAliases(value: Selectable<SiteWidgetTable>['agent_aliases']) {
  return Array.isArray(value)
    ? value
    : (JSON.parse(value) as Selectable<SiteWidgetTable>['agent_aliases']);
}

function mapSiteWidget(row: Selectable<SiteWidgetTable>) {
  return {
    widgetId: row.widget_id,
    widgetKey: row.widget_key,
    displayName: row.display_name,
    version: row.version,
    theme: row.theme,
    launcher: row.launcher,
    placement: row.placement,
    defaultAgentAlias: row.default_agent_alias,
    agentAliases: normalizeAgentAliases(row.agent_aliases),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapConversation(
  row: Selectable<ConversationTable>,
  participants: Selectable<ConversationParticipantTable>[],
): Conversation {
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    principalId: row.principal_id,
    agentRef: row.agent_ref,
    status: row.status,
    participants: participants.map((participant) =>
      participant.kind === 'user'
        ? {
            participantId: participant.participant_id,
            kind: 'user',
            principalId: participant.principal_id as string,
          }
        : {
            participantId: participant.participant_id,
            kind: 'agent',
            agentRef: participant.agent_ref as string,
          },
    ),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMessage(row: Selectable<MessageTable>): Message {
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

function mapEvent(row: Selectable<ConversationEventTable>): ConversationEvent {
  return {
    eventId: row.event_id,
    sequence: row.sequence,
    type: row.type,
    occurredAt: row.occurred_at.toISOString(),
    visibility: row.visibility,
    conversationId: row.conversation_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    data: row.data,
  } as ConversationEvent;
}

function mapRun(row: Selectable<AgentRunTable>) {
  return {
    runId: row.run_id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    conversationId: row.conversation_id,
    userMessageId: row.trigger_message_id,
    assistantMessageId: row.assistant_message_id,
    agentRef: row.agent_ref,
    status: row.status,
    attempt: row.attempt,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}

function mapHandoff(row: Selectable<HandoffTable>) {
  return {
    handoffId: row.handoff_id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
