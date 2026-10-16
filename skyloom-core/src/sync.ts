export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal!.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Counting semaphore. `acquire` resolves with a release function. */
export class Semaphore {
  #free: number;
  #waiters: Array<() => void> = [];
  constructor(size: number) {
    this.#free = Math.max(1, Math.floor(size));
  }
  async acquire(): Promise<() => void> {
    if (this.#free > 0) this.#free--;
    else await new Promise<void>((r) => this.#waiters.push(r));
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.#waiters.shift();
      if (next) next();
      else this.#free++;
    };
  }
}

/** Sliding-window limiter: at most `perMinute` starts in any 60 s window. */
export class RateLimiter {
  #stamps: number[] = [];
  #perMinute: number;
  #now: () => number;
  #sleep: Sleep;
  #chain: Promise<void> = Promise.resolve();
  constructor(perMinute: number, now: () => number = Date.now, sleep: Sleep = realSleep) {
    this.#perMinute = Math.max(1, Math.floor(perMinute));
    this.#now = now;
    this.#sleep = sleep;
  }
  /** Serialised so concurrent callers queue in order instead of stampeding. */
  acquire(signal?: AbortSignal): Promise<void> {
    const run = this.#chain.then(async () => {
      for (;;) {
        const now = this.#now();
        this.#stamps = this.#stamps.filter((t) => now - t < 60_000);
        if (this.#stamps.length < this.#perMinute) {
          this.#stamps.push(now);
          return;
        }
        await this.#sleep(60_000 - (now - this.#stamps[0]!) + 1, signal);
      }
    });
    this.#chain = run.catch(() => {});
    return run;
  }
}
