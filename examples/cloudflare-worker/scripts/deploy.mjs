import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { parseJsonc, reportErrors, verifyProductionConfig } from './verify-production-config.mjs';

/* global console */

const exampleDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceConfigPath = join(exampleDirectory, 'wrangler.jsonc');
const generatedConfigPath = join(exampleDirectory, 'wrangler.deploy.generated.json');

const config = parseJsonc(await readFile(sourceConfigPath, 'utf8'), sourceConfigPath);
config.vars = {
  ...(config.vars ?? {}),
  CHAT_CORE_BASE_URL: process.env.CHAT_CORE_BASE_URL ?? config.vars?.CHAT_CORE_BASE_URL,
  CHAT_SITES: process.env.CHAT_SITES ?? config.vars?.CHAT_SITES,
};

applyRouteConfig(config);

const allowWorkerDevDeploy = process.env.ALLOW_WORKER_DEV_DEPLOY === 'true';
const errors = verifyProductionConfig(config, { allowWorkerDevDeploy });
reportErrors(errors);

await writeFile(generatedConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

const wranglerArgs = ['deploy', '--config', generatedConfigPath, ...process.argv.slice(2)];
console.error(`Running wrangler ${wranglerArgs.join(' ')}`);
const child = spawn('wrangler', wranglerArgs, {
  cwd: exampleDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const exitCode = await new Promise((resolve) => {
  child.on('exit', (code) => resolve(code ?? 1));
  child.on('error', (error) => {
    console.error(error.message);
    resolve(1);
  });
});

process.exit(exitCode);

function applyRouteConfig(config) {
  const route = process.env.CHAT_GATEWAY_ROUTE;
  if (route) {
    delete config.route;
    config.routes = [buildRoute(route)];
    delete config.workers_dev;
    return;
  }

  if (process.env.ALLOW_WORKER_DEV_DEPLOY === 'true') {
    delete config.route;
    delete config.routes;
    config.workers_dev = true;
  }
}

function buildRoute(pattern) {
  if (
    process.env.CHAT_GATEWAY_CUSTOM_DOMAIN !== 'true' &&
    !process.env.CHAT_GATEWAY_ZONE_ID &&
    !process.env.CHAT_GATEWAY_ZONE_NAME
  ) {
    return pattern;
  }

  return {
    pattern,
    ...(process.env.CHAT_GATEWAY_CUSTOM_DOMAIN === 'true' ? { custom_domain: true } : {}),
    ...(process.env.CHAT_GATEWAY_ZONE_ID ? { zone_id: process.env.CHAT_GATEWAY_ZONE_ID } : {}),
    ...(process.env.CHAT_GATEWAY_ZONE_NAME ? { zone_name: process.env.CHAT_GATEWAY_ZONE_NAME } : {}),
  };
}
