import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* global console, URL */

const exampleDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(exampleDirectory, 'wrangler.jsonc');
const configText = await readFile(configPath, 'utf8');

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = parseJsonc(configText, configPath);
  const errors = verifyProductionConfig(config, {
    allowWorkerDevDeploy: process.env.ALLOW_WORKER_DEV_DEPLOY === 'true',
  });
  reportErrors(errors);
}

export function parseJsonc(text, path) {
  try {
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
  } catch (error) {
    throw new Error(`Could not parse ${path}. Keep deployable wrangler.jsonc valid JSONC.`, {
      cause: error,
    });
  }
}

export function verifyProductionConfig(config, options = {}) {
  const errors = [];
  const vars = asRecord(config.vars, 'vars', errors);
  const assets = asRecord(config.assets, 'assets', errors);
  const secrets = asRecord(config.secrets, 'secrets', errors);

  const chatCoreBaseUrl = typeof vars.CHAT_CORE_BASE_URL === 'string' ? vars.CHAT_CORE_BASE_URL : '';
  const chatSites = typeof vars.CHAT_SITES === 'string' ? vars.CHAT_SITES : '';

  if (!chatCoreBaseUrl) {
    errors.push('vars.CHAT_CORE_BASE_URL is required.');
  } else {
    requireHttpsOrigin(chatCoreBaseUrl, 'vars.CHAT_CORE_BASE_URL', errors);
    if (chatCoreBaseUrl.includes('example.com')) {
      errors.push('vars.CHAT_CORE_BASE_URL still uses the example.com placeholder.');
    }
  }

  if (!chatSites) {
    errors.push('vars.CHAT_SITES is required.');
  } else {
    if (chatSites.includes('example.com') || chatSites.includes('example-widget')) {
      errors.push('vars.CHAT_SITES still contains example placeholder sites or widgets.');
    }
    try {
      const sites = JSON.parse(chatSites);
      if (!sites || typeof sites !== 'object' || Array.isArray(sites) || Object.keys(sites).length === 0) {
        errors.push('vars.CHAT_SITES must be a non-empty JSON object keyed by hostname.');
      }
    } catch (error) {
      errors.push(`vars.CHAT_SITES must be valid JSON: ${error.message}`);
    }
  }

  const runWorkerFirst = assets.run_worker_first;
  if (!Array.isArray(runWorkerFirst)) {
    errors.push('assets.run_worker_first must include /widget.js, /widget/config, and /v1/*.');
  } else {
    for (const route of ['/widget.js', '/widget/config', '/v1/*']) {
      if (!runWorkerFirst.includes(route)) {
        errors.push(`assets.run_worker_first must include ${route}.`);
      }
    }
  }

  if (!Array.isArray(secrets.required) || !secrets.required.includes('HAYSTACK_CONNECTOR_TOKEN')) {
    errors.push('secrets.required must include HAYSTACK_CONNECTOR_TOKEN.');
  }

  if (!hasProductionRoute(config) && options.allowWorkerDevDeploy !== true) {
    errors.push(
      'wrangler.jsonc has no routes/custom_domain. Set a production route or run with ALLOW_WORKER_DEV_DEPLOY=true for an intentional workers.dev preview.',
    );
  }

  return errors;
}

export function reportErrors(errors) {
  if (errors.length === 0) {
    return;
  }
  console.error('Refusing to deploy the Cloudflare Worker gateway:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

function asRecord(value, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return {};
  }
  return value;
}

function requireHttpsOrigin(value, label, errors) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${label} must be a valid URL.`);
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    errors.push(`${label} must be an HTTPS origin without path, query, or fragment.`);
  }
}

function hasProductionRoute(value) {
  const routes = value.routes;
  if (Array.isArray(routes) && routes.length > 0) {
    return true;
  }
  if (typeof value.route === 'string' && value.route.length > 0) {
    return true;
  }
  return value.custom_domain === true || value.workers_dev === false;
}
