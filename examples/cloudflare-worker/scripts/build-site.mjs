import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { build } from 'esbuild';

const exampleDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = join(exampleDirectory, '..', '..');
const outputDirectory = join(exampleDirectory, 'dist/site');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: {
    app: join(exampleDirectory, 'site/main.tsx'),
    dashboard: join(repositoryDirectory, 'apps/dashboard/src/main.tsx'),
  },
  bundle: true,
  format: 'esm',
  minify: true,
  outdir: outputDirectory,
  sourcemap: true,
  target: ['es2022'],
});
await build({
  entryPoints: {
    widget: join(exampleDirectory, 'site/widget.ts'),
  },
  bundle: true,
  format: 'esm',
  loader: { '.css': 'text' },
  minify: true,
  outdir: outputDirectory,
  sourcemap: true,
  target: ['es2022'],
});
await copyFile(join(exampleDirectory, 'site/index.html'), join(outputDirectory, 'index.html'));
await copyFile(join(exampleDirectory, 'site/favicon.svg'), join(outputDirectory, 'favicon.svg'));
await copyFile(
  join(exampleDirectory, 'site/dashboard.html'),
  join(outputDirectory, 'dashboard.html'),
);
await copyFile(join(exampleDirectory, 'site/_headers'), join(outputDirectory, '_headers'));
await Promise.all(
  [
    'formation-agent-sprite-v2.webp',
    'formation-agent-sprite-blue.webp',
    'formation-agent-sprite-dark-green.webp',
    'formation-agent-sprite-light.webp',
    'formation-agent-sprite-rgb-neon.webp',
    'formation-user-sprite.webp',
    'formation-user-sprite-alt.webp',
    'formation-user-animal-sprite.webp',
    'agent-flow-diagram-hot-pink.webp',
    'agent-flow-diagram-blue.webp',
    'agent-flow-diagram-dark-green.webp',
    'agent-flow-diagram-light.webp',
    'agent-flow-diagram-rgb-neon.webp',
  ].map((file) => copyFile(join(exampleDirectory, 'site', file), join(outputDirectory, file))),
);
