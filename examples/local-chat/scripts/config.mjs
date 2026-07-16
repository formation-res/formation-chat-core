import { URL } from 'node:url';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

const defaults = {
  agentRef: 'public-support',
  coreBaseUrl: 'http://127.0.0.1:3000',
  connectorMode: 'mock',
  dashboardPort: 4174,
  databaseUrl: 'postgresql://chat_core:chat_core@127.0.0.1:5432/chat_core',
  host: '127.0.0.1',
  port: 4173,
  siteId: 'local-site',
  siteKey: 'local-chat',
  tenantId: 'local-tenant',
};

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function loadLocalChatConfig(env) {
  const port = parsePort('LOCAL_CHAT_PORT', env.LOCAL_CHAT_PORT, defaults.port);
  const dashboardPort = parsePort(
    'LOCAL_CHAT_DASHBOARD_PORT',
    env.LOCAL_CHAT_DASHBOARD_PORT,
    defaults.dashboardPort,
  );
  const coreBaseUrl = parseBaseUrl(env.LOCAL_CHAT_CORE_URL ?? defaults.coreBaseUrl);
  const siteKey = parseId('LOCAL_CHAT_SITE_KEY', env.LOCAL_CHAT_SITE_KEY ?? defaults.siteKey);
  const connectorMode = env.LOCAL_CHAT_CONNECTOR_MODE ?? defaults.connectorMode;
  if (connectorMode !== 'mock' && connectorMode !== 'haystack') {
    throw new Error('LOCAL_CHAT_CONNECTOR_MODE must be mock or haystack.');
  }
  return {
    agentRef: parseId('LOCAL_CHAT_AGENT_REF', env.LOCAL_CHAT_AGENT_REF ?? defaults.agentRef),
    coreBaseUrl,
    connectorMode,
    dashboardOrigin: `http://${defaults.host}:${dashboardPort}`,
    dashboardPort,
    databaseUrl: env.DATABASE_URL ?? defaults.databaseUrl,
    host: defaults.host,
    origin: `http://${defaults.host}:${port}`,
    port,
    siteId: parseId('LOCAL_CHAT_SITE_ID', env.LOCAL_CHAT_SITE_ID ?? defaults.siteId),
    siteKey,
    tenantId: parseId('LOCAL_CHAT_TENANT_ID', env.LOCAL_CHAT_TENANT_ID ?? defaults.tenantId),
  };
}

/** @param {string | undefined} value */
/** @param {string} name @param {string | undefined} value @param {number} fallback */
function parsePort(name, value, fallback) {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

/** @param {string} value */
function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('LOCAL_CHAT_CORE_URL must be an HTTP or HTTPS origin.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('LOCAL_CHAT_CORE_URL must be an HTTP or HTTPS origin without credentials.');
  }
  return url;
}

/** @param {string} name @param {string} value */
function parseId(name, value) {
  if (!OPAQUE_ID.test(value)) throw new Error(`${name} must be a valid opaque ID.`);
  return value;
}
