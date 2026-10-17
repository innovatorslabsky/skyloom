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

describe('fal video provider', () => {
  const fal = (over: Partial<ProviderInput> = {}): ProviderInput => ({ id: 'fal-wan', label: 'fal', kind: 'fal-video', baseUrl: '', model: 'vendor/model', usdPerSecond: 0.1, apiKey: 'fal-secret', ...over });
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  it('validates: price is required, kind is checked, empty address means the https default', () => {
    expect(validateProvider(fal())).toBeUndefined();
    const { usdPerSecond: _omit, ...noPrice } = fal();
    expect(validateProvider(noPrice)).toMatch(/giá mỗi giây/);
    expect(validateProvider(fal({ kind: 'nope' as any }))).toMatch(/Loại/);
    expect(validateProvider(fal({ baseUrl: 'http://example.com' }))).toMatch(/https/);
    expect(validateProvider(fal({ extraInput: [] as any }))).toMatch(/JSON/);
  });

  it('stores the default address, keeps the key out of config, and shows up as the only video provider', async () => {
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config, demo: true, demoDelayMs: 1 });
    expect((await s.saveProvider(fal())).ok).toBe(true);
    expect(m.cfg[0]).toMatchObject({ kind: 'fal-video', baseUrl: 'https://queue.fal.run', usdPerSecond: 0.1 });
    expect(JSON.stringify(m.cfg)).not.toContain('fal-secret');
    const est = await s.estimate(req({ ideas: ['a'], durationSec: 5 }));
    expect(est).toMatchObject({ ok: true, perItem: 500_000 }); // 5 s × $0.10, not the demo provider's price
  });

  it('runs a batch against a fake fal queue and charges seconds × price', async () => {
    const seen: { auth?: string; body?: any }[] = [];
    let origin = '';
    const server = createServer((rq, rs) => {
      let raw = '';
      rq.on('data', (d) => (raw += d));
      rq.on('end', () => {
        rs.setHeader('content-type', 'application/json');
        if (rq.method === 'POST') {
          seen.push({ auth: rq.headers.authorization, body: JSON.parse(raw) });
          rs.end(JSON.stringify({ request_id: 'r', status_url: `${origin}/v/m/requests/r/status`, response_url: `${origin}/v/m/requests/r` }));
        } else if (rq.url!.endsWith('/status')) rs.end(JSON.stringify({ status: 'COMPLETED' }));
        else rs.end(JSON.stringify({ video: { url: 'https://cdn.example/v.mp4' } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => new Promise((r) => server.close(() => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config, retryBaseMs: 1, pollIntervalMs: 1 });
    await s.saveProvider(fal({ baseUrl: origin, model: 'v/m', extraInput: { seed: 7 } }));
    const out = await s.run(req({ ideas: ['núi'], durationSec: 5 }));
    if ('error' in out) throw new Error(out.error);
    expect(out.items[0]).toMatchObject({ ok: true, provider: 'fal-wan', mediaUrl: 'https://cdn.example/v.mp4' });
    expect(out.spentMicro).toBe(500_000);
    expect(seen[0]!.auth).toBe('Key fal-secret');
    expect(seen[0]!.body).toMatchObject({ prompt: 'núi', duration: 5, seed: 7 });
  });

  it('presets: rejects unknown ids and refuses a clip length the model cannot make, before spending anything', async () => {
    expect(validateProvider(fal({ preset: 'nope' }))).toMatch(/Mẫu/);
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config });
    await s.saveProvider(fal({ preset: 'kling-v3-standard' }));
    expect(await s.estimate(req({ durationSec: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining('3–15') });
    expect(await s.run(req({ durationSec: 20 }))).toMatchObject({ error: expect.stringContaining('3–15') });
    expect(await s.estimate(req({ durationSec: 8 }))).toMatchObject({ ok: true });
  });
});

describe('gemini omni video provider', () => {
  const omni = (over: Partial<ProviderInput> = {}): ProviderInput => ({ id: 'omni', label: 'Omni', kind: 'gemini-omni-video', baseUrl: '', model: '', usdPerSecond: 0.1, apiKey: 'g-secret', ...over });
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  it('validates and stores defaults: no model needed, price required, fixedSeconds positive', async () => {
    expect(validateProvider(omni())).toBeUndefined();
    const { usdPerSecond: _u, ...noPrice } = omni();
    expect(validateProvider(noPrice)).toMatch(/giá mỗi giây/);
    expect(validateProvider(omni({ fixedSeconds: 0 }))).toMatch(/lớn hơn 0/);
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config });
    expect((await s.saveProvider(omni())).ok).toBe(true);
    expect(m.cfg[0]).toMatchObject({ baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-omni-1.1-flash' });
    expect(JSON.stringify(m.cfg)).not.toContain('g-secret');
  });

  it('runs a batch, hands inline video bytes to the saver, bills fixedSeconds', async () => {
    const server = createServer((rq, rs) => {
      rq.resume();
      rq.on('end', () => {
        rs.setHeader('content-type', 'application/json');
        rs.end(JSON.stringify({ steps: [{ content: [{ type: 'video', mime_type: 'video/mp4', data: Buffer.from('VID').toString('base64') }] }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => new Promise((r) => server.close(() => r()));
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config, retryBaseMs: 1 });
    await s.saveProvider(omni({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, fixedSeconds: 10 }));
    const saved: Array<[number, string, string]> = [];
    const out = await s.run(req({ ideas: ['a', 'b'], durationSec: 5 }), async (i, bytes, mime) => { saved.push([i, Buffer.from(bytes).toString(), mime]); return `videos/00${i + 1}.mp4`; });
    if ('error' in out) throw new Error(out.error);
    expect(saved.sort()).toEqual([[0, 'VID', 'video/mp4'], [1, 'VID', 'video/mp4']]);
    expect(out.items.map((i) => i.file)).toEqual(['videos/001.mp4', 'videos/002.mp4']);
    expect(out.spentMicro).toBe(2_000_000); // 2 clips × 10 s × $0.10
  });

  it('refuses 1:1 when Omni is the only video provider', async () => {
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config });
    await s.saveProvider(omni());
    expect(await s.estimate(req({ aspect: '1:1' }))).toMatchObject({ ok: false, error: expect.stringContaining('9:16') });
  });

  it('says so when a video arrives inline but there is nowhere to save it', async () => {
    const server = createServer((rq, rs) => { rq.resume(); rq.on('end', () => { rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ x: { mime_type: 'video/mp4', data: 'VklE' } })); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => new Promise((r) => server.close(() => r()));
    const m = memory();
    const s = new SkyloomService({ keys: m.keyStore, config: m.config, retryBaseMs: 1 });
    await s.saveProvider(omni({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
    const out = await s.run(req({ ideas: ['a'] }));
    if ('error' in out) throw new Error(out.error);
    expect(out.items[0]).toMatchObject({ ok: true, downloadError: expect.stringContaining('không có nơi lưu') });
  });
});
