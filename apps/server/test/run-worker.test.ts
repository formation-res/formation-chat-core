import { describe, expect, it, vi } from 'vitest';

import { RunWorker } from '../src/run/worker.js';

describe('RunWorker.run', () => {
  it('stops an idle polling loop when aborted', async () => {
    const worker = new RunWorker(undefined as never, undefined as never, () => undefined, {
      leaseMs: 1,
      maxAttempts: 1,
    });
    const processNext = vi.spyOn(worker, 'processNext').mockResolvedValue(false);
    const controller = new AbortController();
    const running = worker.run(controller.signal, 10);
    await vi.waitFor(() => expect(processNext).toHaveBeenCalled());

    controller.abort();

    await expect(running).resolves.toBeUndefined();
  });
});
