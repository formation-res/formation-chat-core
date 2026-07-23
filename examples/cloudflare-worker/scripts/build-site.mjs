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
    'agent-shadow-tooltip.webp',
    'agent-shadow-tooltip-earth.webp',
    'agent-shadow-tooltip-blue.webp',
    'agent-shadow-tooltip-dark-green.webp',
    'agent-shadow-tooltip-rgb.webp',
    'agent-shadow-tooltip-light.webp',
    'agent-shadow-tooltip-rgb-neon.webp',
  ].map((file) => copyFile(join(exampleDirectory, 'site', file), join(outputDirectory, file))),
);
