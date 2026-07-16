import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const connectorDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const haystackDirectory = resolve(
  process.env.HAYSTACK_MAILAGENT_DIR ?? join(connectorDirectory, '../../../haystack-mailagent'),
);
if (!existsSync(join(haystackDirectory, 'pyproject.toml'))) {
  throw new Error('Set HAYSTACK_MAILAGENT_DIR to a haystack-mailagent checkout.');
}

const python = [
  'import json',
  'from haystack_mailagent.api import app',
  'print(json.dumps(app.openapi()))',
].join('; ');
const result = spawnSync('uv', ['run', 'python', '-c', python], {
  cwd: haystackDirectory,
  encoding: 'utf8',
  env: {
    ...process.env,
    UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? join(tmpdir(), 'formation-chat-uv-cache'),
  },
  maxBuffer: 10 * 1024 * 1024,
});
if (result.status !== 0)
  throw new Error(result.stderr.trim() || 'Could not load Haystack OpenAPI.');

const openapi = JSON.parse(result.stdout);
const operation = openapi.paths?.['/api/agents/knowledge/chat']?.post;
assert.equal(
  operation?.requestBody?.content?.['application/json']?.schema?.$ref,
  '#/components/schemas/AgentRequest',
);
assert.equal(
  operation?.responses?.['200']?.content?.['application/json']?.schema?.$ref,
  '#/components/schemas/AgentResponse',
);

const request = openapi.components?.schemas?.AgentRequest;
const response = openapi.components?.schemas?.AgentResponse;
for (const field of [
  'channel',
  'tenant_key',
  'agent_slug',
  'user_id',
  'thread_id',
  'text',
  'response_mode',
  'metadata',
]) {
  assert.ok(request?.properties?.[field], `AgentRequest.${field} is missing.`);
}
assert.ok(request.properties.channel.enum.includes('web'));
assert.deepEqual(request.required, ['user_id', 'text']);
assert.deepEqual(response.required, [
  'request_id',
  'tenant_key',
  'agent_slug',
  'channel',
  'thread_id',
  'text',
]);
assert.deepEqual(response.properties.status.enum, ['completed', 'failed', 'rejected', 'ignored']);
assert.equal(response.properties.metadata.additionalProperties, true);

process.stdout.write('Haystack compatibility contract matches the current knowledge-chat API.\n');
