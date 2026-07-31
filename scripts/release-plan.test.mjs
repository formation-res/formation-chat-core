import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RELEASE_TARGETS,
  createReleasePlan,
  findOutOfScopePaths,
  mergeProductionWorkerConfig,
  parseReleaseArguments,
} from './release-plan.mjs';

test('cp parses an explicit commit message and file scope', () => {
  assert.deepEqual(
    parseReleaseArguments(['cp', '--message', 'fix: stable preview', '--', 'a.ts', 'b.ts']),
    {
      mode: 'cp',
      message: 'fix: stable preview',
      files: ['a.ts', 'b.ts'],
      staged: false,
      dryRun: false,
    },
  );
});

test('cp requires an explicit staging scope', () => {
  assert.throws(
    () => parseReleaseArguments(['cp', '--message', 'fix: stable preview']),
    /Pass file paths after -- or use --staged/,
  );
});

test('explicit release paths reject unrelated pre-staged files', () => {
  assert.deepEqual(
    findOutOfScopePaths(
      ['scripts/release.mjs', 'docs/operations/release.md', 'unrelated.txt'],
      ['scripts/release.mjs', 'docs'],
    ),
    ['unrelated.txt'],
  );
});

test('cp only checks, commits, and pushes', () => {
  assert.deepEqual(createReleasePlan('cp', 'main'), ['stage', 'verify', 'commit', 'push']);
});

test('cpd waits for the backend deployment before deploying and verifying the Worker', () => {
  assert.deepEqual(createReleasePlan('cpd', 'main'), [
    'stage',
    'verify',
    'verify-worker',
    'commit',
    'push',
    'wait-for-backend',
    'deploy-worker',
    'verify-production',
  ]);
});

test('production Worker config refreshes source settings without losing production bindings', () => {
  const merged = mergeProductionWorkerConfig(
    {
      main: 'src/index.ts',
      compatibility_date: '2026-07-31',
      vars: { CHAT_CORE_BASE_URL: 'https://example.com', NEW_FLAG: 'enabled' },
      assets: { directory: './dist/site', run_worker_first: ['/v1/*'] },
    },
    {
      main: 'old/index.ts',
      compatibility_date: '2026-01-01',
      routes: ['chat.formationxyz.com'],
      vars: {
        CHAT_CORE_BASE_URL: 'https://chat-core.formationxyz.com',
        CHAT_SITES: '{"chat.formationxyz.com":{"siteKey":"main"}}',
      },
      assets: { directory: './old-dist' },
    },
  );

  assert.equal(merged.main, 'src/index.ts');
  assert.equal(merged.compatibility_date, '2026-07-31');
  assert.deepEqual(merged.routes, ['chat.formationxyz.com']);
  assert.deepEqual(merged.assets, {
    directory: './dist/site',
    run_worker_first: ['/v1/*'],
  });
  assert.deepEqual(merged.vars, {
    CHAT_CORE_BASE_URL: 'https://chat-core.formationxyz.com',
    NEW_FLAG: 'enabled',
    CHAT_SITES: '{"chat.formationxyz.com":{"siteKey":"main"}}',
  });
});

test('cpd refuses production deployment from another branch', () => {
  assert.throws(() => createReleasePlan('cpd', 'feature/test'), /requires the main branch/);
});

test('production targets keep deployment inputs and smoke checks explicit', () => {
  assert.equal(RELEASE_TARGETS.backend.workflow, 'publish_containers.yml');
  assert.match(RELEASE_TARGETS.backend.readyUrl, /\/health\/ready$/);
  assert.equal(RELEASE_TARGETS.worker.config, 'wrangler.deploy.generated.json');
  assert.deepEqual(RELEASE_TARGETS.worker.assets, [
    '/widget.js',
    '/dashboard.js',
    '/dashboard.css',
  ]);
});
