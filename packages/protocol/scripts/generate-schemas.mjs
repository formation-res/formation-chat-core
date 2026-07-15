import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commonSchemaArtifacts } from '../dist/common/schemas.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const mismatches = [];

for (const [name, schema] of Object.entries(commonSchemaArtifacts)) {
  const path = resolve(packageRoot, 'schemas/common', `${name}.schema.json`);
  const content = `${JSON.stringify(
    { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema },
    null,
    2,
  )}\n`;

  if (checkOnly) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== content) mismatches.push(path);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

if (mismatches.length > 0) {
  process.stderr.write(`Generated schema drift: ${mismatches.join(', ')}\n`);
  process.exitCode = 1;
}
