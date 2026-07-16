import { createHash, randomUUID } from 'node:crypto';

import type {
  AnonymousBootstrapRequest,
  SessionBootstrapResponse,
} from '@formation-chat-core/protocol';
import { sql } from 'kysely';

import type { Database } from '../database/database.js';
import { SessionTokenService } from './token.js';

export class SessionBootstrapError extends Error {
  constructor(
    readonly code: 'SITE_NOT_FOUND' | 'ORIGIN_NOT_ALLOWED',
    readonly statusCode: 403 | 404,
  ) {
    super(code === 'SITE_NOT_FOUND' ? 'The site was not found.' : 'The origin is not allowed.');
    this.name = 'SessionBootstrapError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly statusCode = 409;

  constructor() {
    super('The idempotency key was already used for a different request.');
    this.name = 'IdempotencyConflictError';
  }
}

export interface BootstrapContext {
  origin: string;
  idempotencyKey: string;
}

const normalizeOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export class SessionService {
  readonly #tokens: SessionTokenService;

  constructor(
    private readonly database: Database,
    secrets: string | [string, ...string[]],
    private readonly ttlSeconds: number,
  ) {
    this.#tokens = new SessionTokenService(secrets, ttlSeconds);
  }

  async bootstrapAnonymous(
    request: AnonymousBootstrapRequest,
    context: BootstrapContext,
    now = new Date(),
  ): Promise<SessionBootstrapResponse> {
    const site = await this.database
      .selectFrom('sites')
      .select(['site_id', 'tenant_id', 'allowed_origins'])
      .where('site_key', '=', request.siteKey)
      .executeTakeFirst();
    if (!site) throw new SessionBootstrapError('SITE_NOT_FOUND', 404);

    const origin = normalizeOrigin(context.origin);
    const allowed = site.allowed_origins.some((candidate) => normalizeOrigin(candidate) === origin);
    if (!origin || !allowed) throw new SessionBootstrapError('ORIGIN_NOT_ALLOWED', 403);

    const requestHash = createHash('sha256')
      .update(JSON.stringify([request.siteKey, request.browserIdentity ?? null]))
      .digest('hex');
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const identity = await this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${site.site_id}:${context.idempotencyKey}`}, 0))`.execute(
        transaction,
      );
      const previous = await transaction
        .selectFrom('session_bootstrap_idempotency')
        .select(['request_hash', 'browser_identity'])
        .where('site_id', '=', site.site_id)
        .where('idempotency_key', '=', context.idempotencyKey)
        .executeTakeFirst();
      if (previous && previous.request_hash !== requestHash) throw new IdempotencyConflictError();
      const browserIdentity = previous?.browser_identity ?? request.browserIdentity ?? randomUUID();

      let principal = await transaction
        .selectFrom('principals')
        .select('principal_id')
        .where('tenant_id', '=', site.tenant_id)
        .where('site_id', '=', site.site_id)
        .where('browser_identity', '=', browserIdentity)
        .executeTakeFirst();

      if (!principal) {
        const principalId = randomUUID();
        await transaction
          .insertInto('principals')
          .values({
            principal_id: principalId,
            tenant_id: site.tenant_id,
            site_id: site.site_id,
            kind: 'anonymous',
            browser_identity: browserIdentity,
          })
          .onConflict((conflict) =>
            conflict.columns(['tenant_id', 'site_id', 'browser_identity']).doNothing(),
          )
          .execute();
        principal = await transaction
          .selectFrom('principals')
          .select('principal_id')
          .where('tenant_id', '=', site.tenant_id)
          .where('site_id', '=', site.site_id)
          .where('browser_identity', '=', browserIdentity)
          .executeTakeFirstOrThrow();
      }

      let session = await transaction
        .selectFrom('browser_sessions')
        .select('session_id')
        .where('tenant_id', '=', site.tenant_id)
        .where('site_id', '=', site.site_id)
        .where('principal_id', '=', principal.principal_id)
        .executeTakeFirst();
      if (!session) {
        const sessionId = randomUUID();
        await transaction
          .insertInto('browser_sessions')
          .values({
            session_id: sessionId,
            tenant_id: site.tenant_id,
            site_id: site.site_id,
            principal_id: principal.principal_id,
            expires_at: expiresAt,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['tenant_id', 'site_id', 'principal_id'])
              .doUpdateSet({ expires_at: expiresAt }),
          )
          .execute();
        session = await transaction
          .selectFrom('browser_sessions')
          .select('session_id')
          .where('tenant_id', '=', site.tenant_id)
          .where('site_id', '=', site.site_id)
          .where('principal_id', '=', principal.principal_id)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .updateTable('browser_sessions')
          .set({ expires_at: expiresAt })
          .where('tenant_id', '=', site.tenant_id)
          .where('site_id', '=', site.site_id)
          .where('session_id', '=', session.session_id)
          .execute();
      }
      if (!previous) {
        await transaction
          .insertInto('session_bootstrap_idempotency')
          .values({
            site_id: site.site_id,
            idempotency_key: context.idempotencyKey,
            request_hash: requestHash,
            browser_identity: browserIdentity,
          })
          .execute();
      }
      return {
        principalId: principal.principal_id,
        sessionId: session.session_id,
        browserIdentity,
      };
    });

    const issued = await this.#tokens.issue(
      {
        tenantId: site.tenant_id,
        siteId: site.site_id,
        principalId: identity.principalId,
        sessionId: identity.sessionId,
      },
      now,
    );
    return {
      accessToken: issued.token,
      tokenType: 'Bearer',
      expiresAt: issued.claims.expiresAt,
      tenantId: site.tenant_id,
      siteId: site.site_id,
      principal: { kind: 'anonymous', principalId: identity.principalId },
      sessionId: identity.sessionId,
      browserIdentity: identity.browserIdentity,
    };
  }
}
