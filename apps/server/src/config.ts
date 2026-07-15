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
  };
}
