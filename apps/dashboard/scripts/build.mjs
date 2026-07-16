import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const directory = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(directory, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: { app: join(directory, 'src/main.tsx') },
  bundle: true,
  format: 'esm',
  minify: true,
  outdir: output,
  sourcemap: true,
  target: ['es2022'],
});
await copyFile(join(directory, 'index.html'), join(output, 'index.html'));
