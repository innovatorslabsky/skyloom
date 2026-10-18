import { describe, expect, it } from 'vitest';
import { Budget, JobFailedError, JobQueue, Registry, BudgetExceededError, mockProvider, usd } from '../src/index.ts';
import type { QueueEvent } from '../src/index.ts';

const video = { kind: 'video', prompt: 'p', durationSec: 8, aspect: '9:16', resolution: '720p' } as const;
const noSleep = { sleep: async () => {}, random: () => 1 };

function setup(providers: ReturnType<typeof mockProvider>[], budget = usd(10), extra = {}) {
  const registry = new Registry();
  providers.forEach((p) => registry.register(p));
  const events: QueueEvent[] = [];
  const queue = new JobQueue({ registry, budget: new Budget(budget), ...noSleep, ...extra });
  queue.on((e) => events.push(e));
  return { queue, events, registry };
}

describe('JobQueue', () => {
  it('retries transient errors on the same provider with backoff, then succeeds', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], failFirst: 2 });
    const { queue, events } = setup([a]);
    const r = await queue.run('j', video);
    expect(r.provider).toBe('a');
    expect(a.calls).toBe(3);
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(2);
  });

  it('honours Retry-After when it is longer than the computed backoff', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], failFirst: 1, failWith: { retryable: true, retryAfterMs: 30_000 } });
    const { queue, events } = setup([a], usd(10), { retry: { baseMs: 10, maxMs: 60_000 } });
    await queue.run('j', video);
    const retry = events.find((e) => e.type === 'retry');
    expect(retry && retry.type === 'retry' && retry.waitMs).toBe(30_000);
  });

  it('falls back to the next provider when the first fails permanently', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], failFirst: 99, failWith: { retryable: false } });
    const b = mockProvider({ id: 'b', kinds: ['video'] });
    const { queue, events } = setup([a, b]);
    const r = await queue.run('j', video);
    expect(r.provider).toBe('b');
    expect(a.calls).toBe(1);
    expect(events.some((e) => e.type === 'fallback')).toBe(true);
  });

  it('reports every attempt when all providers fail', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], failFirst: 99, failWith: { retryable: false } });
    const { queue } = setup([a]);
    await expect(queue.run('j', video)).rejects.toBeInstanceOf(JobFailedError);
  });

  it('gives up on a provider after maxAttempts of transient errors', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], failFirst: 99 });
    const { queue } = setup([a], usd(10), { retry: { maxAttempts: 3 } });
    await expect(queue.run('j', video)).rejects.toBeInstanceOf(JobFailedError);
    expect(a.calls).toBe(3);
  });

  it('stops before overspending: budget is reserved before the call is made', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], costPerCall: usd(1) });
    const { queue } = setup([a], usd(2.5));
    await queue.run('1', video);
    await queue.run('2', video);
    await expect(queue.run('3', video)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(a.calls).toBe(2);
  });

  it('does not charge for failed attempts', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], costPerCall: usd(1), failFirst: 2 });
    const budget = new Budget(usd(5));
    const registry = new Registry().register(a);
    const queue = new JobQueue({ registry, budget, ...noSleep });
    await queue.run('j', video);
    expect(budget.spent).toBe(usd(1));
  });

  it('cheapest strategy picks the lower estimate even if registered later', async () => {
    const pricey = mockProvider({ id: 'pricey', kinds: ['video'], costPerCall: usd(2) });
    const cheap = mockProvider({ id: 'cheap', kinds: ['video'], costPerCall: usd(0.5) });
    const { queue } = setup([pricey, cheap], usd(10), { strategy: 'cheapest' });
    expect((await queue.run('j', video)).provider).toBe('cheap');
  });

  it('never runs more than `concurrency` jobs at once', async () => {
    let live = 0, peak = 0;
    const a = mockProvider({ id: 'a', kinds: ['video'], maxConcurrent: 10, delay: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; } });
    const { queue } = setup([a], usd(10), { concurrency: 3 });
    await Promise.all(Array.from({ length: 12 }, (_, i) => queue.run(String(i), video)));
    expect(peak).toBe(3);
  });

  it('respects a provider rpm by waiting rather than failing', async () => {
    let t = 0;
    const waits: number[] = [];
    const a = mockProvider({ id: 'a', kinds: ['video'], rpm: 2, maxConcurrent: 5 });
    const { queue } = setup([a], usd(10), { now: () => t, sleep: async (ms: number) => { waits.push(ms); t += ms; } });
    await Promise.all([1, 2, 3].map((i) => queue.run(String(i), video)));
    expect(a.calls).toBe(3);
    expect(waits.some((w) => w > 50_000)).toBe(true);
  });

  it('aborts promptly when the signal fires', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'] });
    const { queue } = setup([a]);
    const ac = new AbortController();
    ac.abort(new Error('cancelled'));
    await expect(queue.run('j', video, ac.signal)).rejects.toThrow('cancelled');
    expect(a.calls).toBe(0);
  });
});

describe('mockProvider', () => {
  it('fails exactly the first N calls even when calls overlap', async () => {
    const a = mockProvider({ id: 'a', kinds: ['video'], failFirst: 1, maxConcurrent: 5, delay: () => new Promise((r) => setTimeout(r, 5)) });
    const results = await Promise.allSettled([1, 2, 3].map(() => a.run(video, new AbortController().signal)));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});
