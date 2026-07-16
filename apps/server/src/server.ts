import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyServerOptions } from 'fastify';

import { registerAdminRoutes } from './admin/route.js';
import type { AdminQueryService } from './admin/service.js';
import type { AdminTokenService } from './admin/token.js';
import { registerConversationRoutes } from './conversation/route.js';
import type { ConversationService } from './conversation/service.js';
import { registerEventRoutes } from './event/route.js';
import type { EventService } from './event/service.js';
import type { MessageService } from './message/service.js';
import { registerRunRoutes } from './run/route.js';
import type { RunService } from './run/service.js';
import { getAuditActor, type AuditSink } from './security/audit.js';
import { HttpMetrics, matchesBearerToken } from './security/metrics.js';
import { FixedWindowRateLimiter } from './security/rate-limit.js';
import { registerSessionRoutes, type BootstrapAnonymous } from './session/route.js';
import type { SessionTokenService } from './session/token.js';
import { registerStructuredInputRoutes } from './structured-input/route.js';
import type { StructuredInputService } from './structured-input/service.js';

export interface BuildServerOptions {
  checkDatabase: () => Promise<void>;
  closeDatabase?: () => Promise<void>;
  bootstrapAnonymous?: BootstrapAnonymous;
  conversationService?: ConversationService;
  messageService?: MessageService;
  eventService?: EventService;
  runService?: RunService;
  structuredInputService?: StructuredInputService;
  sessionTokens?: SessionTokenService;
  adminService?: AdminQueryService;
  adminTokens?: AdminTokenService;
  audit?: AuditSink;
  metricsBearerToken?: string;
  logger?: FastifyServerOptions['logger'];
  security?: {
    bodyLimitBytes: number;
    requestTimeoutMs: number;
    trustProxy: boolean;
    rateLimitWindowMs: number;
    publicRateLimitMax: number;
    bootstrapRateLimitMax: number;
    adminRateLimitMax: number;
  };
}

export function buildServer(options: BuildServerOptions) {
  const security = options.security ?? {
    bodyLimitBytes: 262_144,
    requestTimeoutMs: 120_000,
    trustProxy: false,
    rateLimitWindowMs: 60_000,
    publicRateLimitMax: 120,
    bootstrapRateLimitMax: 30,
    adminRateLimitMax: 600,
  };
  const server = Fastify({
    bodyLimit: security.bodyLimitBytes,
    genReqId: () => randomUUID(),
    logger: options.logger ?? true,
    requestIdHeader: false,
    requestTimeout: security.requestTimeoutMs,
    trustProxy: security.trustProxy,
  });

  const createLimiter = (max: number) =>
    new FixedWindowRateLimiter({ windowMs: security.rateLimitWindowMs, max, maxKeys: 10_000 });
  const limiters = {
    public: createLimiter(security.publicRateLimitMax),
    bootstrap: createLimiter(security.bootstrapRateLimitMax),
    admin: createLimiter(security.adminRateLimitMax),
  };
  const metrics = new HttpMetrics();

  server.addHook('onRequest', async (request, reply) => {
    metrics.start(request);
    if (!request.url.startsWith('/v1/')) return;
    const group = request.url.startsWith('/v1/admin')
      ? 'admin'
      : request.url.startsWith('/v1/sessions')
        ? 'bootstrap'
        : 'public';
    const result = limiters[group].consume(`${group}:${request.ip}`);
    void reply.header('ratelimit-limit', result.limit);
    void reply.header('ratelimit-remaining', result.remaining);
    void reply.header('ratelimit-reset', result.resetSeconds);
    if (!result.allowed) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
          correlationId: request.id,
        },
      });
    }
  });

  server.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-correlation-id', request.id);
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    void reply.header(
      'content-security-policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    return payload;
  });

  if (options.audit) {
    server.addHook('onResponse', async (request, reply) => {
      if (!request.url.startsWith('/v1/')) return;
      const statusCode = reply.statusCode;
      await options.audit?.record({
        ...getAuditActor(request),
        correlationId: request.id,
        action: `${request.method} ${request.routeOptions.url ?? '/v1/unmatched'}`,
        outcome:
          statusCode === 401 || statusCode === 403
            ? 'denied'
            : statusCode >= 500
              ? 'failure'
              : 'success',
        statusCode,
      });
    });
  }

  server.addHook('onResponse', async (request, reply) => {
    metrics.finish(request, request.method, reply.statusCode);
  });

  if (options.closeDatabase) server.addHook('onClose', options.closeDatabase);

  server.get('/health/live', async () => ({ status: 'ok' as const }));

  server.get('/health/ready', async (request, reply) => {
    try {
      await options.checkDatabase();
      return { status: 'ready' as const };
    } catch {
      void reply.code(503);
      return {
        status: 'unavailable' as const,
        error: {
          code: 'DATABASE_UNAVAILABLE' as const,
          message: 'The database is unavailable.',
          correlationId: request.id,
        },
      };
    }
  });

  if (options.metricsBearerToken) {
    server.get('/metrics', async (request, reply) => {
      if (
        !matchesBearerToken(request.headers.authorization, options.metricsBearerToken as string)
      ) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Metrics authentication is required.',
            correlationId: request.id,
          },
        });
      }
      return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
    });
  }

  if (options.bootstrapAnonymous) registerSessionRoutes(server, options.bootstrapAnonymous);
  if (options.conversationService && options.messageService && options.sessionTokens) {
    registerConversationRoutes(
      server,
      options.conversationService,
      options.messageService,
      options.sessionTokens,
    );
  }
  if (options.eventService && options.sessionTokens) {
    registerEventRoutes(server, options.eventService, options.sessionTokens);
  }
  if (options.runService && options.sessionTokens) {
    registerRunRoutes(server, options.runService, options.sessionTokens);
  }
  if (options.structuredInputService && options.sessionTokens) {
    registerStructuredInputRoutes(server, options.structuredInputService, options.sessionTokens);
  }
  if (options.adminService && options.adminTokens) {
    registerAdminRoutes(server, options.adminService, options.adminTokens);
  }

  return server;
}
