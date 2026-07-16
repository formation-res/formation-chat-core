import {
  type HaystackConnectorMap,
  parseHaystackConnectorMap,
} from '@formation-chat-core/haystack-connector';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ServerConfig {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: LogLevel;
  databasePoolMax: number;
  sessionTokenSecret: string;
  sessionTokenPreviousSecrets: string[];
  sessionTokenTtlSeconds: number;
  admin?: { tokenSecret: string; previousTokenSecrets: string[]; tokenTtlSeconds: number };
  eventRetentionMaxEvents: number;
  eventSubscriberBufferSize: number;
  connectorMode: 'disabled' | 'mock' | 'haystack';
  haystackConnectors: HaystackConnectorMap;
  runWorkerPollIntervalMs: number;
  runLeaseMs: number;
  runMaxAttempts: number;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  trustProxy: boolean;
  rateLimitWindowMs: number;
  publicRateLimitMax: number;
  bootstrapRateLimitMax: number;
  adminRateLimitMax: number;
  anonymousRetentionDays: number;
  authenticatedRetentionDays: number;
  contactValueRetentionHours: number;
  retentionSweepIntervalMs: number;
  metricsBearerToken?: string;
}

export class ConfigurationError extends Error {
  constructor(keys: string[]) {
    super(`Invalid configuration: ${keys.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

const logLevels = new Set<LogLevel>(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
};

const isDatabaseUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
};

const parsePreviousSecrets = (value: string | undefined): string[] | undefined => {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length > 2 ||
      parsed.some((secret) => typeof secret !== 'string' || Buffer.byteLength(secret) < 32) ||
      new Set(parsed).size !== parsed.length
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
};

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const invalid: string[] = [];
  const port = parseInteger(env.PORT, 3000);
  const databasePoolMax = parseInteger(env.DB_POOL_MAX, 10);
  const sessionTokenTtlSeconds = parseInteger(env.SESSION_TOKEN_TTL_SECONDS, 900);
  const adminTokenTtlSeconds = parseInteger(env.ADMIN_TOKEN_TTL_SECONDS, 3600);
  const adminConfigured =
    env.ADMIN_TOKEN_SECRET !== undefined ||
    env.ADMIN_TOKEN_TTL_SECONDS !== undefined ||
    env.ADMIN_TOKEN_PREVIOUS_SECRETS !== undefined;
  const sessionTokenPreviousSecrets = parsePreviousSecrets(env.SESSION_TOKEN_PREVIOUS_SECRETS);
  const adminTokenPreviousSecrets = parsePreviousSecrets(env.ADMIN_TOKEN_PREVIOUS_SECRETS);
  const eventRetentionMaxEvents = parseInteger(env.EVENT_RETENTION_MAX_EVENTS, 1000);
  const eventSubscriberBufferSize = parseInteger(env.EVENT_SUBSCRIBER_BUFFER_SIZE, 100);
  const connectorMode = env.CONNECTOR_MODE ?? 'disabled';
  let haystackConnectors: HaystackConnectorMap = {};
  const runWorkerPollIntervalMs = parseInteger(env.RUN_WORKER_POLL_INTERVAL_MS, 250);
  const runLeaseMs = parseInteger(env.RUN_LEASE_MS, 30_000);
  const runMaxAttempts = parseInteger(env.RUN_MAX_ATTEMPTS, 3);
  const logLevel = env.LOG_LEVEL ?? 'info';
  const bodyLimitBytes = parseInteger(env.HTTP_BODY_LIMIT_BYTES, 262_144);
  const requestTimeoutMs = parseInteger(env.REQUEST_TIMEOUT_MS, 120_000);
  const trustProxy = env.TRUST_PROXY === undefined ? false : env.TRUST_PROXY === 'true';
  const rateLimitWindowMs = parseInteger(env.RATE_LIMIT_WINDOW_MS, 60_000);
  const publicRateLimitMax = parseInteger(env.PUBLIC_RATE_LIMIT_MAX, 120);
  const bootstrapRateLimitMax = parseInteger(env.BOOTSTRAP_RATE_LIMIT_MAX, 30);
  const adminRateLimitMax = parseInteger(env.ADMIN_RATE_LIMIT_MAX, 600);
  const anonymousRetentionDays = parseInteger(env.ANONYMOUS_RETENTION_DAYS, 30);
  const authenticatedRetentionDays = parseInteger(env.AUTHENTICATED_RETENTION_DAYS, 365);
  const contactValueRetentionHours = parseInteger(env.CONTACT_VALUE_RETENTION_HOURS, 24);
  const retentionSweepIntervalMs = parseInteger(env.RETENTION_SWEEP_INTERVAL_MS, 3_600_000);
  const metricsConfigured = env.METRICS_BEARER_TOKEN !== undefined;

  if (!isDatabaseUrl(env.DATABASE_URL)) invalid.push('DATABASE_URL');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) invalid.push('PORT');
  if (!logLevels.has(logLevel as LogLevel)) invalid.push('LOG_LEVEL');
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) {
    invalid.push('DB_POOL_MAX');
  }
  if (!env.SESSION_TOKEN_SECRET || Buffer.byteLength(env.SESSION_TOKEN_SECRET) < 32) {
    invalid.push('SESSION_TOKEN_SECRET');
  }
  if (
    !sessionTokenPreviousSecrets ||
    sessionTokenPreviousSecrets.includes(env.SESSION_TOKEN_SECRET ?? '')
  ) {
    invalid.push('SESSION_TOKEN_PREVIOUS_SECRETS');
  }
  if (
    !Number.isInteger(sessionTokenTtlSeconds) ||
    sessionTokenTtlSeconds < 60 ||
    sessionTokenTtlSeconds > 3600
  ) {
    invalid.push('SESSION_TOKEN_TTL_SECONDS');
  }
  if (
    adminConfigured &&
    (!env.ADMIN_TOKEN_SECRET || Buffer.byteLength(env.ADMIN_TOKEN_SECRET) < 32)
  ) {
    invalid.push('ADMIN_TOKEN_SECRET');
  }
  if (
    adminConfigured &&
    (!adminTokenPreviousSecrets || adminTokenPreviousSecrets.includes(env.ADMIN_TOKEN_SECRET ?? ''))
  ) {
    invalid.push('ADMIN_TOKEN_PREVIOUS_SECRETS');
  }
  if (
    adminConfigured &&
    (!Number.isInteger(adminTokenTtlSeconds) ||
      adminTokenTtlSeconds < 60 ||
      adminTokenTtlSeconds > 86_400)
  ) {
    invalid.push('ADMIN_TOKEN_TTL_SECONDS');
  }
  if (
    !Number.isInteger(eventRetentionMaxEvents) ||
    eventRetentionMaxEvents < 1 ||
    eventRetentionMaxEvents > 1_000_000
  ) {
    invalid.push('EVENT_RETENTION_MAX_EVENTS');
  }
  if (
    !Number.isInteger(eventSubscriberBufferSize) ||
    eventSubscriberBufferSize < 1 ||
    eventSubscriberBufferSize > 10_000
  ) {
    invalid.push('EVENT_SUBSCRIBER_BUFFER_SIZE');
  }
  if (connectorMode !== 'disabled' && connectorMode !== 'mock' && connectorMode !== 'haystack') {
    invalid.push('CONNECTOR_MODE');
  }
  if (connectorMode === 'haystack') {
    try {
      haystackConnectors = parseHaystackConnectorMap(JSON.parse(env.HAYSTACK_CONNECTORS ?? ''));
    } catch {
      invalid.push('HAYSTACK_CONNECTORS');
    }
  }
  if (
    !Number.isInteger(runWorkerPollIntervalMs) ||
    runWorkerPollIntervalMs < 10 ||
    runWorkerPollIntervalMs > 60_000
  ) {
    invalid.push('RUN_WORKER_POLL_INTERVAL_MS');
  }
  if (!Number.isInteger(runLeaseMs) || runLeaseMs < 1_000 || runLeaseMs > 3_600_000) {
    invalid.push('RUN_LEASE_MS');
  }
  if (!Number.isInteger(runMaxAttempts) || runMaxAttempts < 1 || runMaxAttempts > 20) {
    invalid.push('RUN_MAX_ATTEMPTS');
  }
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes < 1_024 || bodyLimitBytes > 1_048_576) {
    invalid.push('HTTP_BODY_LIMIT_BYTES');
  }
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1_000 ||
    requestTimeoutMs > 300_000
  ) {
    invalid.push('REQUEST_TIMEOUT_MS');
  }
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== 'true' && env.TRUST_PROXY !== 'false') {
    invalid.push('TRUST_PROXY');
  }
  if (
    !Number.isInteger(rateLimitWindowMs) ||
    rateLimitWindowMs < 1_000 ||
    rateLimitWindowMs > 3_600_000
  ) {
    invalid.push('RATE_LIMIT_WINDOW_MS');
  }
  if (
    !Number.isInteger(publicRateLimitMax) ||
    publicRateLimitMax < 1 ||
    publicRateLimitMax > 100_000
  ) {
    invalid.push('PUBLIC_RATE_LIMIT_MAX');
  }
  if (
    !Number.isInteger(bootstrapRateLimitMax) ||
    bootstrapRateLimitMax < 1 ||
    bootstrapRateLimitMax > 100_000
  ) {
    invalid.push('BOOTSTRAP_RATE_LIMIT_MAX');
  }
  if (
    !Number.isInteger(adminRateLimitMax) ||
    adminRateLimitMax < 1 ||
    adminRateLimitMax > 100_000
  ) {
    invalid.push('ADMIN_RATE_LIMIT_MAX');
  }
  if (
    !Number.isInteger(anonymousRetentionDays) ||
    anonymousRetentionDays < 1 ||
    anonymousRetentionDays > 3_650
  ) {
    invalid.push('ANONYMOUS_RETENTION_DAYS');
  }
  if (
    !Number.isInteger(authenticatedRetentionDays) ||
    authenticatedRetentionDays < 1 ||
    authenticatedRetentionDays > 3_650
  ) {
    invalid.push('AUTHENTICATED_RETENTION_DAYS');
  }
  if (
    !Number.isInteger(contactValueRetentionHours) ||
    contactValueRetentionHours < 1 ||
    contactValueRetentionHours > 8_760
  ) {
    invalid.push('CONTACT_VALUE_RETENTION_HOURS');
  }
  if (
    !Number.isInteger(retentionSweepIntervalMs) ||
    retentionSweepIntervalMs < 60_000 ||
    retentionSweepIntervalMs > 86_400_000
  ) {
    invalid.push('RETENTION_SWEEP_INTERVAL_MS');
  }
  if (metricsConfigured && Buffer.byteLength(env.METRICS_BEARER_TOKEN ?? '') < 32) {
    invalid.push('METRICS_BEARER_TOKEN');
  }
  if (invalid.length > 0) throw new ConfigurationError(invalid);

  return {
    databaseUrl: env.DATABASE_URL as string,
    host: env.HOST ?? '0.0.0.0',
    port,
    logLevel: logLevel as LogLevel,
    databasePoolMax,
    sessionTokenSecret: env.SESSION_TOKEN_SECRET as string,
    sessionTokenPreviousSecrets: sessionTokenPreviousSecrets as string[],
    sessionTokenTtlSeconds,
    ...(adminConfigured
      ? {
          admin: {
            tokenSecret: env.ADMIN_TOKEN_SECRET as string,
            previousTokenSecrets: adminTokenPreviousSecrets as string[],
            tokenTtlSeconds: adminTokenTtlSeconds,
          },
        }
      : {}),
    eventRetentionMaxEvents,
    eventSubscriberBufferSize,
    connectorMode: connectorMode as ServerConfig['connectorMode'],
    haystackConnectors,
    runWorkerPollIntervalMs,
    runLeaseMs,
    runMaxAttempts,
    bodyLimitBytes,
    requestTimeoutMs,
    trustProxy,
    rateLimitWindowMs,
    publicRateLimitMax,
    bootstrapRateLimitMax,
    adminRateLimitMax,
    anonymousRetentionDays,
    authenticatedRetentionDays,
    contactValueRetentionHours,
    retentionSweepIntervalMs,
    ...(metricsConfigured ? { metricsBearerToken: env.METRICS_BEARER_TOKEN as string } : {}),
  };
}
