import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Budget, JobQueue, ProviderError, Registry, estimateBatch, falImage, findImage, imageSize, runBatch, usd } from '../src/index.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
interface Req { method: string; url: string; auth?: string; body: any }
async function serve(result: unknown = { images: [{ url: 'https://cdn/i.jpg', content_type: 'image/jpeg' }] }, statusExtra: object = {}) {
  const log: Req[] = [];
  let origin = '';
  const server = createServer((rq, rs) => {
    let raw = '';
    rq.on('data', (d) => (raw += d));
    rq.on('end', () => {
      log.push({ method: rq.method!, url: rq.url!, auth: rq.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
      rs.setHeader('content-type', 'application/json');
      if (rq.method === 'POST') rs.end(JSON.stringify({ request_id: 'r', status_url: `${origin}/m/requests/r/status`, response_url: `${origin}/m/requests/r/response` }));
      else if (rq.url!.endsWith('/status')) rs.end(JSON.stringify({ status: 'COMPLETED', ...statusExtra }));
      else rs.end(JSON.stringify(result));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise((r) => server.close(() => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, log };
}
const img = { kind: 'image', prompt: 'a cat', width: 576, height: 1024 } as const;
const mk = (baseUrl: string, extra = {}) => falImage({ id: 'fi', label: 'fal img', apiKey: 'fal-secret', baseUrl, pollIntervalMs: 1, sleep: async () => {}, ...extra });

describe('falImage', () => {
  it('sends the size object and key, returns the first image with its mime type', async () => {
    const s = await serve();
    const out = await mk(s.origin).run(img, new AbortController().signal);
    expect(out.media).toEqual({ url: 'https://cdn/i.jpg', mime: 'image/jpeg' });
    expect(s.log[0]!.auth).toBe('Key fal-secret');
    expect(s.log[0]!.url).toBe('/fal-ai/flux/schnell');
    expect(s.log[0]!.body).toEqual({ num_images: 1, image_size: { width: 576, height: 1024 }, prompt: 'a cat' });
  });
  it('extraInput overrides defaults but never the prompt', async () => {
    const s = await serve();
    await mk(s.origin, { extraInput: { num_inference_steps: 2, output_format: 'png', prompt: 'evil' } }).run(img, new AbortController().signal);
    expect(s.log[0]!.body).toMatchObject({ num_inference_steps: 2, output_format: 'png', prompt: 'a cat' });
  });
  it('prices by megapixel: default model has a listed price, others must give one', () => {
    expect(mk('http://x').estimate(img)).toBe(usd(0.576 * 1024 / 1000 * 0.003));
    expect(mk('http://x').estimate({ kind: 'video', prompt: 'x', durationSec: 1, aspect: '16:9', resolution: '720p' })).toBe(0);
    expect(() => mk('http://x', { model: 'other/model' })).toThrow(/no price known/);
    expect(mk('http://x', { model: 'other/model', usdPerMegapixel: 0.01 }).estimate({ ...img, width: 1000, height: 1000 })).toBe(usd(0.01));
  });
  it('a COMPLETED-with-error status and a missing image are permanent failures', async () => {
    const e1 = await serve(undefined, { error: 'nsfw blocked' });
    expect(await mk(e1.origin).run(img, new AbortController().signal).catch((e) => e)).toMatchObject({ retryable: false, message: expect.stringContaining('nsfw') });
    await close?.(); close = undefined;
    const e2 = await serve({ images: [] });
    const err = await mk(e2.origin).run(img, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });
  it('findImage falls back to jpeg for odd content types', () => {
    expect(findImage({ images: [{ url: 'u', content_type: 'text/html' }] })).toEqual({ url: 'u', mime: 'image/jpeg' });
    expect(findImage({})).toBeUndefined();
  });
});

describe('image batches', () => {
  it('estimates and runs image ideas through the registry as image calls', async () => {
    const s = await serve();
    const reg = new Registry();
    reg.register(mk(s.origin));
    const spec = { ideas: ['a', 'b'], video: { durationSec: 5, aspect: '9:16' as const, resolution: '720p' as const }, kind: 'image' as const, noun: 'ảnh' };
    const est = estimateBatch(reg, spec);
    expect(est.perItem).toBe(usd(0.576 * 1.024 * 0.003));
    expect(est.text).toContain('2 ảnh');
    const queue = new JobQueue({ registry: reg, budget: new Budget(usd(1)), strategy: 'cheapest', concurrency: 2, retry: { baseMs: 1 } });
    const { items } = await runBatch(queue, spec);
    expect(items.every((i) => i.ok)).toBe(true);
    expect(s.log.filter((r) => r.method === 'POST').map((r) => r.body.image_size)).toEqual([{ width: 576, height: 1024 }, { width: 576, height: 1024 }]);
    expect(imageSize('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(imageSize('16:9')).toEqual({ width: 1024, height: 576 });
  });
});
