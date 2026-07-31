import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import {
  parseJsonc,
  verifyProductionConfig,
} from '../examples/cloudflare-worker/scripts/verify-production-config.mjs';
import {
  RELEASE_TARGETS,
  createReleasePlan,
  findOutOfScopePaths,
  mergeProductionWorkerConfig,
  parseReleaseArguments,
} from './release-plan.mjs';

/* global AbortSignal, console, fetch, setTimeout */

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseReleaseArguments(process.argv.slice(2));
const branch = (await capture('git', ['branch', '--show-current'])).trim();
const plan = createReleasePlan(options.mode, branch);

console.log(`${options.mode}: ${plan.join(' -> ')}`);
if (options.dryRun) {
  console.log('Dry run only; no files, Git state, or deployment were changed.');
  process.exit(0);
}

await assertRepository();
await stageReleaseFiles();
await verifyRelease();
await run('git', ['commit', '-m', options.message]);
await run('git', ['push', 'origin', `HEAD:${branch}`]);

if (options.mode === 'cpd') {
  const commit = (await capture('git', ['rev-parse', 'HEAD'])).trim();
  await waitForBackendDeployment(commit);
  await deployWorker();
  await verifyProduction(commit);
}

console.log(`${options.mode} complete.`);

async function assertRepository() {
  const topLevel = resolve((await capture('git', ['rev-parse', '--show-toplevel'])).trim());
  if (topLevel !== rootDirectory) {
    throw new Error(`Run this release from ${rootDirectory}.`);
  }
  if (!branch) {
    throw new Error('Refusing to release from a detached HEAD.');
  }
  const remote = (await capture('git', ['remote', 'get-url', 'origin'])).trim();
  if (!remote.includes('formation-chat-core')) {
    throw new Error(`Unexpected origin remote: ${remote}`);
  }
}

async function stageReleaseFiles() {
  if (!options.staged) {
    const paths = options.files.map(assertSafeRepositoryPath);
    const alreadyStaged = await stagedFileNames();
    const unrelated = findOutOfScopePaths(alreadyStaged, paths);
    if (unrelated.length > 0) {
      throw new Error(
        `Refusing to include pre-staged files outside this release: ${unrelated.join(', ')}`,
      );
    }
    await run('git', ['add', '--', ...paths]);
  }

  const stagedNames = await stagedFileNames();
  if (stagedNames.length === 0) {
    throw new Error('Nothing is staged for release.');
  }

  console.log(`Staged ${stagedNames.length} file(s): ${stagedNames.join(', ')}`);
}

async function stagedFileNames() {
  return (await capture('git', ['diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB']))
    .trim()
    .split('\n')
    .filter(Boolean);
}

function assertSafeRepositoryPath(path) {
  const absolutePath = resolve(rootDirectory, path);
  const repositoryPath = relative(rootDirectory, absolutePath);
  if (!repositoryPath || repositoryPath.startsWith('..') || repositoryPath.includes('/../')) {
    throw new Error(`Release path is outside the repository: ${path}`);
  }
  return repositoryPath;
}

async function verifyRelease() {
  await run('git', ['diff', '--cached', '--check']);
  await scanStagedDiff();
  await run('npm', ['run', 'build']);
  await run('npm', ['test']);
  await run('npm', ['run', 'typecheck']);
  await run('npm', ['run', 'lint']);
  await run('npm', ['audit', '--omit=dev', '--audit-level=high']);
  if (options.mode === 'cpd') {
    await run('npm', [
      'run',
      'test:runtime',
      '--workspace',
      '@formation-chat-core/cloudflare-worker-example',
    ]);
    await run('npm', [
      'run',
      'test:browser',
      '--workspace',
      '@formation-chat-core/cloudflare-worker-example',
    ]);
    await prepareProductionWorkerConfig();
    await run(
      'npm',
      [
        'exec',
        '--',
        'wrangler',
        'deploy',
        '--dry-run',
        '--config',
        RELEASE_TARGETS.worker.config,
        '--keep-vars',
      ],
      join(rootDirectory, RELEASE_TARGETS.worker.directory),
    );
  }
}

async function scanStagedDiff() {
  const patch = await capture('git', ['diff', '--cached', '--no-ext-diff', '--unified=0']);
  const additions = patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[opsu]_[A-Za-z0-9]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(additions))) {
    throw new Error('The staged diff contains a likely credential. Remove it before releasing.');
  }
}

async function waitForBackendDeployment(commit) {
  const workflow = RELEASE_TARGETS.backend.workflow;
  console.log(`Waiting for ${workflow} at ${commit.slice(0, 12)}...`);
  let runId;
  for (let attempt = 0; attempt < 40 && !runId; attempt += 1) {
    const output = await capture('gh', [
      'run',
      'list',
      '--workflow',
      workflow,
      '--commit',
      commit,
      '--limit',
      '1',
      '--json',
      'databaseId',
    ]);
    runId = JSON.parse(output)[0]?.databaseId;
    if (!runId) {
      await delay(3_000);
    }
  }
  if (!runId) {
    throw new Error(`GitHub did not start ${workflow} for ${commit}.`);
  }
  await run('gh', ['run', 'watch', String(runId), '--exit-status']);
  await assertOk(RELEASE_TARGETS.backend.readyUrl, 'backend readiness');
}

async function deployWorker() {
  const worker = RELEASE_TARGETS.worker;
  const directory = join(rootDirectory, worker.directory);
  await run(
    'npm',
    ['exec', '--', 'wrangler', 'deploy', '--config', worker.config, '--keep-vars'],
    directory,
  );
}

async function prepareProductionWorkerConfig() {
  const worker = RELEASE_TARGETS.worker;
  const directory = join(rootDirectory, worker.directory);
  const sourcePath = join(directory, 'wrangler.jsonc');
  const productionPath = join(directory, worker.config);
  const source = parseJsonc(await readFile(sourcePath, 'utf8'), sourcePath);
  const production = parseJsonc(await readFile(productionPath, 'utf8'), productionPath);
  const refreshed = mergeProductionWorkerConfig(source, production);
  const errors = verifyProductionConfig(refreshed);
  if (errors.length > 0) {
    throw new Error(`Invalid generated production Worker config:\n- ${errors.join('\n- ')}`);
  }
  await writeFile(productionPath, `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8');
  console.log('Refreshed and validated the ignored production Worker config.');
}

async function verifyProduction(commit) {
  const worker = RELEASE_TARGETS.worker;
  for (const asset of worker.assets) {
    const deployedUrl = new URL(asset, worker.origin);
    deployedUrl.searchParams.set('release', commit);
    const response = await fetch(deployedUrl, {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`${deployedUrl.pathname} returned HTTP ${response.status}.`);
    }
    const deployed = Buffer.from(await response.arrayBuffer());
    const local = await readFile(
      join(rootDirectory, worker.directory, 'dist/site', asset.slice(1)),
    );
    if (sha256(deployed) !== sha256(local)) {
      throw new Error(`${asset} does not match the locally built release asset.`);
    }
    console.log(`Verified ${asset} (${response.headers.get('content-type') ?? 'unknown type'}).`);
  }
}

async function assertOk(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${url}`);
  }
  console.log(`Verified ${label}.`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function run(command, arguments_, cwd = rootDirectory) {
  console.log(`> ${command} ${arguments_.join(' ')}`);
  const exitCode = await spawnResult(command, arguments_, cwd, 'inherit');
  if (exitCode !== 0) {
    throw new Error(`${command} failed with exit code ${exitCode}.`);
  }
}

async function capture(command, arguments_, cwd = rootDirectory) {
  const chunks = [];
  const exitCode = await spawnResult(
    command,
    arguments_,
    cwd,
    ['ignore', 'pipe', 'inherit'],
    chunks,
  );
  if (exitCode !== 0) {
    throw new Error(`${command} failed with exit code ${exitCode}.`);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function spawnResult(command, arguments_, cwd, stdio, chunks = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio, shell: false });
    child.stdout?.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}
