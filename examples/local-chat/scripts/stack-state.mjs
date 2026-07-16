import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const stackStatePath = join(tmpdir(), 'formation-chat-core-local-dev.json');

/** @typedef {{ pid: number, repository: string, startedPostgres: boolean }} StackState */

/** @returns {Promise<StackState | undefined>} */
export async function readStackState() {
  try {
    const value = JSON.parse(await readFile(stackStatePath, 'utf8'));
    if (
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.repository !== 'string' ||
      typeof value.startedPostgres !== 'boolean'
    ) {
      throw new Error('Local development state is invalid.');
    }
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** @param {StackState} state */
export async function writeStackState(state) {
  await writeFile(stackStatePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

export async function removeStackState() {
  await rm(stackStatePath, { force: true });
}

/** @param {number} pid */
export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM';
  }
}

/** @param {unknown} error @returns {error is NodeJS.ErrnoException} */
function isNodeError(error) {
  return error instanceof Error;
}
