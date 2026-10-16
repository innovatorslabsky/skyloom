import { describe, expect, it } from 'vitest';
import { Budget, JobQueue, Registry, estimateBatch, mockProvider, pollUntilDone, runBatch, usd } from '../src/index.ts';

const spec = { ideas: ['sóng biển', 'núi', 'phố cổ'], video: { durationSec: 8, aspect: '9:16', resolution: '720p' } } as const;

describe('estimateBatch / runBatch', () => {
  it('prices the batch with the cheapest provider before running anything', () => {
    const registry = new Registry()
      .register(mockProvider({ id: 'txt', kinds: ['text'], costPerCall: usd(0.01) }))
      .register(mockProvider({ id: 'v1', kinds: ['video'], costPerCall: usd(1) }))
      .register(mockProvider({ id: 'v2', kinds: ['video'], costPerCall: usd(0.4) }));
    const e = estimateBatch(registry, { ...spec, expandWithText: true });
    expect(e.perItem).toBe(usd(0.41));
    expect(e.total).toBe(usd(1.23));
  });

  it('one failing item does not stop the others, and spend only counts successes', async () => {
    let n = 0;
    const bad = mockProvider({ id: 'v', kinds: ['video'], costPerCall: usd(1), maxConcurrent: 1 });
    const orig = bad.run.bind(bad);
    bad.run = async (c, s) => { if (++n === 2) throw new Error('boom'); return orig(c, s); };
    const registry = new Registry().register(bad);
    const queue = new JobQueue({ registry, budget: new Budget(usd(10)), sleep: async () => {}, concurrency: 1 });
    const r = await runBatch(queue, spec);
    expect(r.items.filter((i) => i.ok)).toHaveLength(2);
    expect(r.items.filter((i) => !i.ok)).toHaveLength(1);
    expect(r.spent).toBe(usd(2));
  });

  it('expands ideas with the text provider and feeds the result to video', async () => {
    const registry = new Registry().register(mockProvider({ id: 't', kinds: ['text'] })).register(mockProvider({ id: 'v', kinds: ['video'] }));
    const queue = new JobQueue({ registry, budget: new Budget(usd(1)), sleep: async () => {} });
    const r = await runBatch(queue, { ...spec, ideas: ['núi'], expandWithText: true });
    expect(r.items[0]).toMatchObject({ ok: true, prompt: 'Scene: núi' });
  });
});

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as { retryable: boolean });

describe('pollUntilDone', () => {
  it('polls until done', async () => {
    let n = 0;
    const v = await pollUntilDone(async () => (++n < 3 ? { done: false } : { done: true, value: 'ok' }), { intervalMs: 1, timeoutMs: 1000, sleep: async () => {} });
    expect(v).toBe('ok');
    expect(n).toBe(3);
  });
  it('times out as a retryable error', async () => {
    let t = 0;
    const err = await fail(pollUntilDone(async () => ({ done: false }), { intervalMs: 10, timeoutMs: 25, now: () => t, sleep: async (ms) => { t += ms; } }));
    expect(err.retryable).toBe(true);
  });
  it('a remote failure is permanent', async () => {
    const err = await fail(pollUntilDone(async () => ({ done: true, error: 'rejected' }), { intervalMs: 1, timeoutMs: 100, sleep: async () => {} }));
    expect(err.retryable).toBe(false);
  });
});
