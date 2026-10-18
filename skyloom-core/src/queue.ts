import { Budget } from './budget.ts';
import type { Registry, Strategy } from './registry.ts';
import { RateLimiter, Semaphore, realSleep } from './sync.ts';
import type { Sleep } from './sync.ts';
import { BudgetExceededError, JobFailedError, NoProviderError, ProviderError } from './types.ts';
import type { Attempt, Call, MicroUsd, Output, Provider } from './types.ts';

export interface RetryPolicy { maxAttempts: number; baseMs: number; maxMs: number }
export interface QueueOptions {
  registry: Registry;
  budget: Budget;
  /** Jobs running at once across all providers. */
  concurrency?: number;
  strategy?: Strategy;
  retry?: Partial<RetryPolicy>;
  sleep?: Sleep;
  now?: () => number;
  /** 0..1, injectable so tests are deterministic. */
  random?: () => number;
}
export interface JobResult { provider: string; output: Output; cost: MicroUsd; attempts: number }
export type QueueEvent =
  | { type: 'start'; job: string; provider: string; attempt: number }
  | { type: 'retry'; job: string; provider: string; attempt: number; waitMs: number; error: string }
  | { type: 'fallback'; job: string; from: string; error: string }
  | { type: 'done'; job: string; provider: string; cost: MicroUsd }
  | { type: 'failed'; job: string; error: string };

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseMs: 1_000, maxMs: 60_000 };

/**
 * Runs generation jobs with bounded concurrency. For each job: pick providers by strategy,
 * respect each provider's rate limit and concurrency, reserve budget before every attempt,
 * retry transient errors with exponential backoff (honouring Retry-After), and fall back to
 * the next provider when one fails for good. It never rotates identities to dodge a limit:
 * a rate limit is waited out, and a refused request is not retried elsewhere under another account.
 */
export class JobQueue {
  #o: Required<Omit<QueueOptions, 'retry'>> & { retry: RetryPolicy };
  #global: Semaphore;
  #perProvider = new Map<string, { sem: Semaphore; rate: RateLimiter | undefined }>();
  #listeners = new Set<(e: QueueEvent) => void>();

  constructor(o: QueueOptions) {
    this.#o = {
      registry: o.registry,
      budget: o.budget,
      concurrency: o.concurrency ?? 4,
      strategy: o.strategy ?? 'priority',
      retry: { ...DEFAULT_RETRY, ...o.retry },
      sleep: o.sleep ?? realSleep,
      now: o.now ?? Date.now,
      random: o.random ?? Math.random,
    };
    this.#global = new Semaphore(this.#o.concurrency);
  }

  on(fn: (e: QueueEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  #emit(e: QueueEvent): void {
    for (const fn of this.#listeners) fn(e);
  }
  #state(p: Provider) {
    let s = this.#perProvider.get(p.id);
    if (!s) {
      s = { sem: new Semaphore(p.maxConcurrent ?? 1), rate: p.rpm ? new RateLimiter(p.rpm, this.#o.now, this.#o.sleep) : undefined };
      this.#perProvider.set(p.id, s);
    }
    return s;
  }
  #backoff(attempt: number, retryAfterMs: number | undefined): number {
    const { baseMs, maxMs } = this.#o.retry;
    const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
    const jittered = Math.round(exp / 2 + (exp / 2) * this.#o.random());
    return Math.min(maxMs, Math.max(jittered, retryAfterMs ?? 0));
  }

  async run(job: string, call: Call, signal: AbortSignal = new AbortController().signal): Promise<JobResult> {
    const candidates = this.#o.registry.route(call, this.#o.strategy);
    if (candidates.length === 0) throw new NoProviderError(`No provider registered for ${call.kind}.`);
    const release = await this.#global.acquire();
    const attempts: Attempt[] = [];
    try {
      for (const provider of candidates) {
        const r = await this.#tryProvider(job, call, provider, attempts, signal);
        if (r) return r;
      }
      const last = attempts.at(-1)?.error ?? 'unknown error';
      this.#emit({ type: 'failed', job, error: last });
      throw new JobFailedError(`Job ${job} failed on every provider: ${last}`, attempts);
    } finally {
      release();
    }
  }

  async #tryProvider(job: string, call: Call, provider: Provider, attempts: Attempt[], signal: AbortSignal): Promise<JobResult | undefined> {
    const st = this.#state(provider);
    const { maxAttempts } = this.#o.retry;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      signal.throwIfAborted();
      const estimate = provider.estimate(call);
      // Budget is checked before anything is sent. Exceeding it is final, not a reason to try another provider.
      const reservation = this.#o.budget.reserve(estimate);
      const releaseSlot = await st.sem.acquire();
      try {
        await st.rate?.acquire(signal);
        this.#emit({ type: 'start', job, provider: provider.id, attempt });
        const output = await provider.run(call, signal);
        this.#o.budget.commit(reservation, estimate);
        this.#emit({ type: 'done', job, provider: provider.id, cost: estimate });
        return { provider: provider.id, output, cost: estimate, attempts: attempts.length + 1 };
      } catch (err) {
        this.#o.budget.release(reservation);
        if (signal.aborted) throw err;
        if (err instanceof BudgetExceededError) throw err;
        const pe = err instanceof ProviderError ? err : new ProviderError(String((err as Error)?.message ?? err), { retryable: false, cause: err });
        attempts.push({ provider: provider.id, attempt, error: pe.message, retryable: pe.retryable });
        if (!pe.retryable || attempt === maxAttempts) {
          this.#emit({ type: 'fallback', job, from: provider.id, error: pe.message });
          return undefined;
        }
        const waitMs = this.#backoff(attempt, pe.retryAfterMs);
        this.#emit({ type: 'retry', job, provider: provider.id, attempt, waitMs, error: pe.message });
        releaseSlot();
        await this.#o.sleep(waitMs, signal);
        // loop continues; slot is re-acquired next iteration
        continue;
      } finally {
        releaseSlot();
      }
    }
    return undefined;
  }
}
