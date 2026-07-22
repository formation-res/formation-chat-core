import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist/site');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: { widget: join(root, 'site/widget.ts') },
  bundle: true,
  format: 'esm',
  loader: { '.css': 'text' },
  minify: true,
  outdir: output,
  sourcemap: true,
  target: ['es2022'],
});
await Promise.all(
  [
    'index.html',
    '_headers',
    'agent-shadow-tooltip.webp',
    'agent-shadow-tooltip-earth.webp',
    'agent-shadow-tooltip-blue.webp',
    'agent-shadow-tooltip-dark-green.webp',
    'agent-shadow-tooltip-rgb.webp',
    'agent-shadow-tooltip-light.webp',
    'agent-shadow-tooltip-rgb-neon.webp',
  ].map((file) => copyFile(join(root, 'site', file), join(output, file))),
);
