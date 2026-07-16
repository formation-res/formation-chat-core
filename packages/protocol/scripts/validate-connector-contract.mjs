import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const [requestPath] = process.argv.slice(2);
if (!requestPath) {
  throw new Error('Usage: node validate-connector-contract.mjs <execution-request.json>');
}

const protocolRoot = new URL('../', import.meta.url);
const [requestSchema, eventSchema, request, standardInput] = await Promise.all([
  readFile(
    new URL('schemas/chat/connector-execution-request.schema.json', protocolRoot),
    'utf8',
  ).then(JSON.parse),
  readFile(new URL('schemas/chat/connector-event.schema.json', protocolRoot), 'utf8').then(
    JSON.parse,
  ),
  readFile(requestPath, 'utf8').then(JSON.parse),
  new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  }),
]);
const events = JSON.parse(standardInput);
if (!Array.isArray(events)) {
  throw new Error('Standard input must be a JSON array of connector events.');
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRequest = ajv.compile(requestSchema);
const validateEvent = ajv.compile(eventSchema);

if (!validateRequest(request)) {
  throw new Error(`Invalid connector execution request: ${ajv.errorsText(validateRequest.errors)}`);
}
for (const [index, event] of events.entries()) {
  if (!validateEvent(event)) {
    throw new Error(`Invalid connector event ${index}: ${ajv.errorsText(validateEvent.errors)}`);
  }
}

process.stdout.write(`validated request and ${events.length} connector events\n`);
