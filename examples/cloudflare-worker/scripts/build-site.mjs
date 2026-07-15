import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { build } from 'esbuild';

const exampleDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(exampleDirectory, 'dist/site');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: { app: join(exampleDirectory, 'site/main.tsx') },
  bundle: true,
  format: 'esm',
  minify: true,
  outdir: outputDirectory,
  sourcemap: true,
  target: ['es2022'],
});
await copyFile(join(exampleDirectory, 'site/index.html'), join(outputDirectory, 'index.html'));
await copyFile(join(exampleDirectory, 'site/_headers'), join(outputDirectory, '_headers'));
