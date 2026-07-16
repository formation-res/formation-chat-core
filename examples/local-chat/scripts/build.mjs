import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { build } from 'esbuild';

const exampleDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildLocalChat() {
  const outputDirectory = join(exampleDirectory, 'dist');
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
  return outputDirectory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildLocalChat();
