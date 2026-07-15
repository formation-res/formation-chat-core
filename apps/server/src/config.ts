export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ServerConfig {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: LogLevel;
  databasePoolMax: number;
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
  const logLevel = env.LOG_LEVEL ?? 'info';

  if (!isDatabaseUrl(env.DATABASE_URL)) invalid.push('DATABASE_URL');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) invalid.push('PORT');
  if (!logLevels.has(logLevel as LogLevel)) invalid.push('LOG_LEVEL');
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) {
    invalid.push('DB_POOL_MAX');
  }
  if (invalid.length > 0) throw new ConfigurationError(invalid);

  return {
    databaseUrl: env.DATABASE_URL as string,
    host: env.HOST ?? '0.0.0.0',
    port,
    logLevel: logLevel as LogLevel,
    databasePoolMax,
  };
}
