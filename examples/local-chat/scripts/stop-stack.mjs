import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isProcessRunning, readStackState, removeStackState } from './stack-state.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const state = await readStackState();

if (!state) {
  process.stdout.write('The local development stack is not running.\n');
} else if (state.repository !== repository) {
  throw new Error(`The active local stack belongs to ${state.repository}.`);
} else {
  if (isProcessRunning(state.pid)) {
    process.kill(state.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 100 && (await stackIsStopping(state.pid)); attempt += 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
    if (await stackIsStopping(state.pid)) {
      throw new Error('The local stack did not stop within 10 seconds. Check its terminal output.');
    }
  } else if (state.startedPostgres) {
    await run('docker', ['compose', 'stop', 'postgres']);
    await removeStackState();
  } else {
    await removeStackState();
  }
  process.stdout.write('Local development stack stopped.\n');
}

/** @param {number} pid */
async function stackIsStopping(pid) {
  return isProcessRunning(pid) && (await readStackState()) !== undefined;
}

/** @param {string} command @param {string[]} args */
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve(undefined) : reject(new Error(`${command} exited with code ${code}.`)),
    );
  });
}
