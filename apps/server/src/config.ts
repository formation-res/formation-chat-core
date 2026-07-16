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
  sessionTokenTtlSeconds: number;
  eventRetentionMaxEvents: number;
  eventSubscriberBufferSize: number;
  connectorMode: 'disabled' | 'mock' | 'haystack';
  haystackConnectors: HaystackConnectorMap;
  runWorkerPollIntervalMs: number;
  runLeaseMs: number;
  runMaxAttempts: number;
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

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const invalid: string[] = [];
  const port = parseInteger(env.PORT, 3000);
  const databasePoolMax = parseInteger(env.DB_POOL_MAX, 10);
  const sessionTokenTtlSeconds = parseInteger(env.SESSION_TOKEN_TTL_SECONDS, 900);
  const eventRetentionMaxEvents = parseInteger(env.EVENT_RETENTION_MAX_EVENTS, 1000);
  const eventSubscriberBufferSize = parseInteger(env.EVENT_SUBSCRIBER_BUFFER_SIZE, 100);
  const connectorMode = env.CONNECTOR_MODE ?? 'disabled';
  let haystackConnectors: HaystackConnectorMap = {};
  const runWorkerPollIntervalMs = parseInteger(env.RUN_WORKER_POLL_INTERVAL_MS, 250);
  const runLeaseMs = parseInteger(env.RUN_LEASE_MS, 30_000);
  const runMaxAttempts = parseInteger(env.RUN_MAX_ATTEMPTS, 3);
  const logLevel = env.LOG_LEVEL ?? 'info';

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
    !Number.isInteger(sessionTokenTtlSeconds) ||
    sessionTokenTtlSeconds < 60 ||
    sessionTokenTtlSeconds > 3600
  ) {
    invalid.push('SESSION_TOKEN_TTL_SECONDS');
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
  if (invalid.length > 0) throw new ConfigurationError(invalid);

  return {
    databaseUrl: env.DATABASE_URL as string,
    host: env.HOST ?? '0.0.0.0',
    port,
    logLevel: logLevel as LogLevel,
    databasePoolMax,
    sessionTokenSecret: env.SESSION_TOKEN_SECRET as string,
    sessionTokenTtlSeconds,
    eventRetentionMaxEvents,
    eventSubscriberBufferSize,
    connectorMode: connectorMode as ServerConfig['connectorMode'],
    haystackConnectors,
    runWorkerPollIntervalMs,
    runLeaseMs,
    runMaxAttempts,
  };
}
