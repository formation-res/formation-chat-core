import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HaystackAgentRequestSchema,
  HaystackAgentResponseSchema,
  HaystackConnectorConfigSchema,
  HaystackConnectorMapSchema,
} from '../dist/index.js';

const directory = join(dirname(fileURLToPath(import.meta.url)), '../schemas');
const schemas = {
  'haystack-agent-request': HaystackAgentRequestSchema,
  'haystack-agent-response': HaystackAgentResponseSchema,
  'haystack-connector-config': HaystackConnectorConfigSchema,
  'haystack-connector-map': HaystackConnectorMapSchema,
};
const check = process.argv.includes('--check');
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const path = join(directory, `${name}.schema.json`);
  const content = `${JSON.stringify({ $id: `formation-chat-core/${name}`, ...schema }, null, 2)}\n`;
  if (check) {
    const existing = await readFile(path, 'utf8').catch(() => '');
    if (existing !== content) throw new Error(`Generated schema is stale: ${path}`);
  } else {
    await writeFile(path, content);
  }
}
