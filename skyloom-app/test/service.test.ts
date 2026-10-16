import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SkyloomService, validateBatch, validateProvider } from '../src/service.ts';
import type { ConfigStore, KeyStore } from '../src/service.ts';
import type { BatchRequest, ProviderConfig, ProviderInput } from '../src/shared/api.ts';

const memory = () => {
  let cfg: ProviderConfig[] = [];
  const keys = new Map<string, string>();
  const config: ConfigStore = { load: async () => cfg, save: async (l) => { cfg = l; } };
  const keyStore: KeyStore = { get: async (id) => keys.get(id), set: async (id, k) => { keys.set(id, k); }, delete: async (id) => { keys.delete(id); } };
  return { config, keyStore, keys, get cfg() { return cfg; } };
};
const req = (over: Partial<BatchRequest> = {}): BatchRequest => ({ ideas: ['a', 'b', 'c'], durationSec: 8, aspect: '9:16', resolution: '720p', expandWithText: false, budgetUsd: 10, strategy: 'cheapest', ...over });
const prov = (over: Partial<ProviderInput> = {}): ProviderInput => ({ id: 'nim', label: 'NIM', kind: 'openai-compat-text', baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'sk-secret', ...over });

describe('validation', () => {
  it('requires https except loopback and rejects credentials in the URL', () => {
    expect(validateProvider(prov({ baseUrl: 'http://example.com/v1' }))).toBeTruthy();
    expect(validateProvider(prov({ baseUrl: 'http://127.0.0.1:8000/v1' }))).toBeUndefined();
    expect(validateProvider(prov({ baseUrl: 'https://user:pw@example.com/v1' }))).toBeTruthy();
    expect(validateProvider(prov({ baseUrl: 'not a url' }))).toBeTruthy();
  });
  it('rejects bad ids, empty keys and negative prices', () => {
    expect(validateProvider(prov({ id: 'Bad Id' }))).toBeTruthy();
    expect(validateProvider(prov({ apiKey: ' ' }))).toBeTruthy();
    expect(validateProvider(prov({ usdPerMillionIn: -1 }))).toBeTruthy();
  });
  it('bounds batch size, idea length, duration and budget', () => {
    expect(validateBatch(req({ ideas: [] }))).toBeTruthy();
    expect(validateBatch(req({ ideas: Array(501).fill('x') }))).toBeTruthy();
    expect(validateBatch(req({ ideas: ['x'.repeat(2001)] }))).toBeTruthy();
    expect(validateBatch(req({ durationSec: 0 }))).toBeTruthy();
    expect(validateBatch(req({ budgetUsd: -1 }))).toBeTruthy();
    expect(validateBatch(req())).toBeUndefined();
  });
});

describe('providers', () => {
  it('never returns the key and keeps it in the key store only', async () => {
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config });
    expect((await s.saveProvider(prov())).ok).toBe(true);
    expect(JSON.stringify(await s.listProviders())).not.toContain('sk-secret');
    expect(JSON.stringify(m.cfg)).not.toContain('sk-secret');
    expect(m.keys.get('nim')).toBe('sk-secret');
  });
  it('reports a key-store failure as an error result and creates no provider entry', async () => {
    const m = memory();
    const failing: KeyStore = { ...m.keyStore, set: async () => { throw new Error('no keyring'); } };
    const s = new SkyloomService({ keys: failing, config: m.config });
    expect(await s.saveProvider(prov())).toEqual({ ok: false, error: 'no keyring' });
    expect(await s.listProviders()).toEqual([]);
  });
  it('removing a provider deletes its key too', async () => {
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config });
    await s.saveProvider(prov());
    await s.removeProvider('nim');
    expect(m.keys.size).toBe(0);
    expect(await s.listProviders()).toEqual([]);
  });
});

describe('batches', () => {
  it('without demo mode and no video provider, says so instead of inventing one', async () => {
    const s = new SkyloomService({ ...(({ keyStore, config }) => ({ keys: keyStore, config }))(memory()) });
    const e = await s.estimate(req());
    expect(e.ok).toBe(false);
  });

  it('demo mode runs a whole batch, retries the first failure, and reports spend', async () => {
    const m = memory();
    const events: string[] = [];
    const s = new SkyloomService({ keys: m.keyStore, config: m.config, demo: true, demoDelayMs: 1, retryBaseMs: 1, onEvent: (e) => events.push(e.type) });
    const e = await s.estimate(req({ ideas: ['a', 'b'] }));
    expect(e.ok && e.total).toBe(100_000); // 2 × $0.05
    const out = await s.run(req({ ideas: ['a', 'b'] }));
    if ('error' in out) throw new Error(out.error);
    expect(out.items.every((i) => i.ok)).toBe(true);
    expect(out.spentMicro).toBe(100_000);
    expect(events).toContain('retry'); // demo video provider fails its first call on purpose
  });

  it('stops at the budget cap instead of overspending', async () => {
    const s = new SkyloomService({ ...(({ keyStore, config }) => ({ keys: keyStore, config }))(memory()), demo: true, demoDelayMs: 1, retryBaseMs: 1 });
    const out = await s.run(req({ ideas: ['a', 'b', 'c', 'd'], budgetUsd: 0.1 }));
    if ('error' in out) throw new Error(out.error);
    expect(out.items.filter((i) => i.ok)).toHaveLength(2);
    expect(out.spentMicro).toBeLessThanOrEqual(100_000);
  });

  it('refuses a second concurrent run and can cancel the first', async () => {
    const s = new SkyloomService({ ...(({ keyStore, config }) => ({ keys: keyStore, config }))(memory()), demo: true, demoDelayMs: 50, retryBaseMs: 1 });
    const first = s.run(req({ ideas: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    await new Promise((r) => setTimeout(r, 10));
    expect('error' in (await s.run(req()))).toBe(true);
    await s.cancel();
    const out = await first;
    expect('cancelled' in out && out.cancelled).toBe(true);
  });
});

describe('real text provider path', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  it('uses the saved key to call the provider and feeds its text to the video step', async () => {
    let auth: string | undefined;
    const server = createServer((rq, rs) => { auth = rq.headers.authorization; rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ choices: [{ message: { content: 'cảnh chi tiết' } }] })); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => new Promise((r) => server.close(() => r()));
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config, demo: true, demoDelayMs: 1, retryBaseMs: 1 });
    await s.saveProvider(prov({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` }));
    const out = await s.run(req({ ideas: ['núi'], expandWithText: true }));
    if ('error' in out) throw new Error(out.error);
    expect(auth).toBe('Bearer sk-secret');
    expect(out.items[0]).toMatchObject({ ok: true, prompt: 'cảnh chi tiết' });
  });
});
