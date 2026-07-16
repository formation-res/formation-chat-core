import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import pg from 'pg';

import { loadLocalChatConfig } from './config.mjs';
import { createLocalChatServer } from './local-server.mjs';
import { provisionLocalChatSite } from './provision.mjs';
import {
  isProcessRunning,
  readStackState,
  removeStackState,
  writeStackState,
} from './stack-state.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repository = join(scriptDirectory, '../../..');
const localSecret = 'local-development-session-secret-1234567890';
const adminSecret = 'local-development-admin-secret-1234567890';
const config = loadLocalChatConfig(process.env);
/** @type {Set<import('node:child_process').ChildProcess>} */
const childProcesses = new Set();
/** @type {Set<import('node:http').Server>} */
const httpServers = new Set();
let startedPostgres = false;
let stopping = false;
let ownsState = false;
/** @type {() => void} */
let requestStop = () => {};
/** @type {Promise<void>} */
const stopRequested = new Promise((resolve) => {
  requestStop = resolve;
});

process.once('SIGINT', () => requestStop());
process.once('SIGTERM', () => requestStop());

try {
  await ensureSingleStack();
  assertSupervisorConfig();
  await assertPortsAvailable();
  startedPostgres = !(await isPostgresRunning());
  await writeStackState({ pid: process.pid, repository, startedPostgres });
  ownsState = true;

  if (startedPostgres) await run('docker', ['compose', 'up', '-d', 'postgres']);
  await waitForPostgres();

  if (process.env.LOCAL_CHAT_SKIP_BUILD !== 'true') await run('npm', ['run', 'build']);

  const core = startCore();
  await waitForCore(core);
  await provisionSite();
  const adminToken = await issueAdminToken();

  const visitor = createLocalChatServer({
    coreBaseUrl: config.coreBaseUrl,
    rootDirectory: join(repository, 'examples/local-chat/dist'),
    siteKey: config.siteKey,
  });
  const dashboard = createLocalChatServer({
    apiPathPrefixes: ['/v1/admin/'],
    coreBaseUrl: config.coreBaseUrl,
    rootDirectory: join(repository, 'apps/dashboard/dist'),
  });
  httpServers.add(visitor);
  httpServers.add(dashboard);
  await listen(visitor, config.port);
  await listen(dashboard, config.dashboardPort);

  process.stdout.write(
    `\nLocal stack is ready.\n\n` +
      `Visitor chat: ${config.origin}\n` +
      `Dashboard:    ${config.dashboardOrigin}\n` +
      `Chat Core:    ${config.coreBaseUrl.origin}\n` +
      `Connector:    ${config.connectorMode}\n\n` +
      `Paste this scoped local admin token into the dashboard:\n${adminToken}\n\n` +
      `Stop with Ctrl+C here, or run npm run dev:local:stop in another terminal.\n`,
  );

  await Promise.race([
    stopRequested,
    new Promise((_, reject) =>
      core.once('exit', (code, signal) =>
        reject(new Error(`Chat Core stopped unexpectedly (${signal ?? `exit ${code}`}).`)),
      ),
    ),
  ]);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  await cleanup();
}

async function ensureSingleStack() {
  const state = await readStackState();
  if (!state) return;
  if (state.repository !== repository) {
    throw new Error(
      `Another local stack owns ${state.repository}. Stop it before starting this one.`,
    );
  }
  if (isProcessRunning(state.pid)) {
    throw new Error('The local development stack is already running.');
  }
  if (ownsState) await removeStackState();
}

function assertSupervisorConfig() {
  if (
    config.coreBaseUrl.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(config.coreBaseUrl.hostname)
  ) {
    throw new Error('dev:local requires LOCAL_CHAT_CORE_URL to use localhost over HTTP.');
  }
  if (config.connectorMode === 'haystack' && !process.env.HAYSTACK_CONNECTORS) {
    throw new Error('HAYSTACK_CONNECTORS is required when LOCAL_CHAT_CONNECTOR_MODE=haystack.');
  }
}

async function assertPortsAvailable() {
  const ports = [Number(config.coreBaseUrl.port || 80), config.port, config.dashboardPort];
  if (new Set(ports).size !== ports.length) {
    throw new Error('Chat Core, visitor UI, and dashboard must use different local ports.');
  }
  for (const port of ports) {
    if (await isPortInUse(port)) {
      throw new Error(
        `Port ${port} is already in use. Stop the older local process or configure another port.`,
      );
    }
  }
}

/** @param {number} port */
async function isPortInUse(port) {
  return await new Promise((resolve) => {
    const socket = connect({ host: config.host, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function isPostgresRunning() {
  const result = await capture('docker', ['compose', 'ps', '--status', 'running', '--services']);
  return result.split(/\r?\n/).includes('postgres');
}

async function waitForPostgres() {
  await retry('PostgreSQL', async () => {
    await capture('docker', [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-U',
      'chat_core',
      '-d',
      'chat_core',
    ]);
  });
}

function startCore() {
  const core = spawn(process.execPath, ['apps/server/dist/index.js'], {
    cwd: repository,
    env: {
      ...process.env,
      ADMIN_TOKEN_SECRET: adminSecret,
      ADMIN_TOKEN_TTL_SECONDS: '28800',
      CONNECTOR_MODE: config.connectorMode,
      DATABASE_URL: config.databaseUrl,
      HOST: config.coreBaseUrl.hostname,
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
      PORT: config.coreBaseUrl.port || '80',
      SESSION_TOKEN_SECRET: localSecret,
    },
    stdio: 'inherit',
  });
  childProcesses.add(core);
  core.once('exit', () => childProcesses.delete(core));
  return core;
}

/** @param {import('node:child_process').ChildProcess} core */
async function waitForCore(core) {
  await retry('Chat Core', async () => {
    if (core.exitCode !== null) throw new Error('Chat Core process exited.');
    const response = await globalThis.fetch(new URL('/health/ready', config.coreBaseUrl));
    if (!response.ok) throw new Error(`readiness returned ${response.status}`);
  });
}

async function provisionSite() {
  const database = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await provisionLocalChatSite(database, config);
  } finally {
    await database.end();
  }
}

async function issueAdminToken() {
  const moduleUrl = pathToFileURL(join(repository, 'apps/server/dist/admin/token.js')).href;
  const { AdminTokenService } = await import(moduleUrl);
  const service = new AdminTokenService(adminSecret, 28_800);
  const { token } = await service.issue({
    adminId: 'local-operator',
    tenantId: config.tenantId,
    siteIds: [config.siteId],
    scopes: ['admin:read', 'admin:internal'],
  });
  return token;
}

/** @param {import('node:http').Server} server @param {number} port */
async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: config.host, port }, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
}

/** @param {string} label @param {() => Promise<void>} operation */
async function retry(label, operation) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `${label} did not become ready: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

/** @param {string} command @param {string[]} args */
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, stdio: 'inherit' });
    childProcesses.add(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      childProcesses.delete(child);
      if (code === 0) resolve(undefined);
      else reject(new Error(`${command} stopped (${signal ?? `exit ${code}`}).`));
    });
  });
}

/** @param {string} command @param {string[]} args @returns {Promise<string>} */
async function capture(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} failed: ${stderr.trim()}`));
    });
  });
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const server of httpServers) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
  for (const child of childProcesses) child.kill('SIGTERM');
  await Promise.all([...childProcesses].map(waitForExit));
  if (startedPostgres) {
    await run('docker', ['compose', 'stop', 'postgres']).catch((error) =>
      process.stderr.write(`Could not stop PostgreSQL: ${error.message}\n`),
    );
  }
  await removeStackState();
}

/** @param {import('node:child_process').ChildProcess} child */
async function waitForExit(child) {
  if (hasExited(child)) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => globalThis.setTimeout(resolve, 10_000)),
  ]);
  if (!hasExited(child)) child.kill('SIGKILL');
}

/** @param {import('node:child_process').ChildProcess} child */
function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
