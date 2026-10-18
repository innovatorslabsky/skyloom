import { ProviderError } from './types.ts';
import { realSleep } from './sync.ts';
import type { Sleep } from './sync.ts';

export type PollState<T> = { done: false } | { done: true; value: T } | { done: true; error: string };

/**
 * Video APIs are asynchronous: submit a job, then poll until it finishes. This wraps that loop
 * with a deadline so a stuck remote job becomes a retryable error instead of hanging a worker.
 */
export async function pollUntilDone<T>(
  check: () => Promise<PollState<T>>,
  o: { intervalMs: number; timeoutMs: number; signal?: AbortSignal; sleep?: Sleep; now?: () => number },
): Promise<T> {
  const sleep = o.sleep ?? realSleep;
  const now = o.now ?? Date.now;
  const deadline = now() + o.timeoutMs;
  for (;;) {
    o.signal?.throwIfAborted();
    const s = await check();
    if (s.done) {
      if ('error' in s) throw new ProviderError(s.error, { retryable: false });
      return s.value;
    }
    if (now() + o.intervalMs > deadline) throw new ProviderError('Timed out waiting for the remote job.', { retryable: true });
    await sleep(o.intervalMs, o.signal);
  }
}
