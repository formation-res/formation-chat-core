export const RELEASE_TARGETS = Object.freeze({
  backend: Object.freeze({
    workflow: 'publish_containers.yml',
    readyUrl: 'https://chat-core.formationxyz.com/health/ready',
  }),
  worker: Object.freeze({
    directory: 'examples/cloudflare-worker',
    config: 'wrangler.deploy.generated.json',
    origin: 'https://chat.formationxyz.com',
    assets: Object.freeze(['/widget.js', '/dashboard.js', '/dashboard.css']),
  }),
});

const COMMON_ACTIONS = Object.freeze(['stage', 'verify', 'commit', 'push']);

export function createReleasePlan(mode, branch) {
  if (mode === 'cp') {
    return [...COMMON_ACTIONS];
  }
  if (mode !== 'cpd') {
    throw new Error('Mode must be cp or cpd.');
  }
  if (branch !== 'main') {
    throw new Error('cpd requires the main branch because it deploys production.');
  }
  return [
    'stage',
    'verify',
    'verify-worker',
    'commit',
    'push',
    'wait-for-backend',
    'deploy-worker',
    'verify-production',
  ];
}

export function mergeProductionWorkerConfig(source, production) {
  return {
    ...production,
    ...source,
    vars: {
      ...(source.vars ?? {}),
      CHAT_CORE_BASE_URL: production.vars?.CHAT_CORE_BASE_URL,
      CHAT_SITES: production.vars?.CHAT_SITES,
    },
  };
}

export function findOutOfScopePaths(stagedPaths, releasePaths) {
  return stagedPaths.filter(
    (stagedPath) =>
      !releasePaths.some(
        (releasePath) =>
          stagedPath === releasePath || stagedPath.startsWith(`${releasePath.replace(/\/$/, '')}/`),
      ),
  );
}

export function parseReleaseArguments(arguments_) {
  const [mode, ...tokens] = arguments_;
  if (mode !== 'cp' && mode !== 'cpd') {
    throw new Error('Usage: npm run cp|cpd -- --message "type: summary" -- <files...>');
  }

  let message = '';
  let staged = false;
  let dryRun = false;
  let files = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      files = tokens.slice(index + 1);
      break;
    }
    if (token === '--message' || token === '-m') {
      message = tokens[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token === '--staged') {
      staged = true;
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown release option: ${token}`);
  }

  if (!message.trim()) {
    throw new Error('Pass a commit message with --message.');
  }
  if (staged && files.length > 0) {
    throw new Error('Use either explicit file paths or --staged, not both.');
  }
  if (!staged && files.length === 0) {
    throw new Error('Pass file paths after -- or use --staged.');
  }

  return { mode, message, files, staged, dryRun };
}
