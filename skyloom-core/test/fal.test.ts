import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError, falVideo, usd } from '../src/index.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

interface Req { method: string; url: string; auth?: string; body: any }
async function serve(handler: (r: Req, origin: string) => { status: number; body: unknown }) {
  const log: Req[] = [];
  let origin = '';
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const r: Req = { method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
      log.push(r);
      const out = handler(r, origin);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise((r) => server.close(() => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, log };
}

const video = { kind: 'video', prompt: 'a cat', durationSec: 5, aspect: '9:16', resolution: '720p' } as const;
const mk = (baseUrl: string, extra = {}) => falVideo({ id: 'fal', label: 'fal', apiKey: 'fal-secret', model: 'vendor/model', usdPerSecond: 0.1, baseUrl, pollIntervalMs: 1, sleep: async () => {}, ...extra });
const queue = (statuses: string[], resultBody: unknown = { video: { url: 'https://cdn/x.mp4' } }) => {
  let i = 0;
  return (r: Req, origin: string) => {
    if (r.method === 'POST') return { status: 200, body: { request_id: 'r1', status_url: `${origin}/vendor/model/requests/r1/status`, response_url: `${origin}/vendor/model/requests/r1`, cancel_url: `${origin}/vendor/model/requests/r1/cancel` } };
    if (r.url.endsWith('/status')) return { status: 200, body: { status: statuses[Math.min(i++, statuses.length - 1)] } };
    return { status: 200, body: resultBody };
  };
};

describe('falVideo', () => {
  it('prices by seconds', () => {
    expect(mk('http://x').estimate(video)).toBe(usd(0.5));
    expect(mk('http://x').estimate({ kind: 'text', prompt: 'x' })).toBe(0);
  });

  it('submits, polls until COMPLETED, and returns the video url', async () => {
    const s = await serve(queue(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']));
    const out = await mk(s.origin).run(video, new AbortController().signal);
    expect(out.media).toEqual({ url: 'https://cdn/x.mp4', mime: 'video/mp4' });
    expect(s.log[0]!.auth).toBe('Key fal-secret');
    expect(s.log[0]!.url).toBe('/vendor/model');
    expect(s.log[0]!.body).toMatchObject({ prompt: 'a cat', duration: 5, aspect_ratio: '9:16', resolution: '720p' });
    expect(s.log.filter((r) => r.url.endsWith('/status'))).toHaveLength(3);
  });

  it('refuses status urls on another host so the key is never sent there', async () => {
    const s = await serve((r) => ({ status: 200, body: { request_id: 'r', status_url: 'https://evil.example/s', response_url: 'https://evil.example/r' } }));
    const err = await mk(s.origin).run(video, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(s.log).toHaveLength(1);
  });

  it('honours custom input and url extraction', async () => {
    const s = await serve(queue(['COMPLETED'], { videos: [{ url: 'https://cdn/y.mp4' }] }));
    const p = mk(s.origin, { buildInput: (c: any) => ({ text: c.prompt }), extractUrl: (r: any) => r.videos[0].url });
    expect((await p.run(video, new AbortController().signal)).media?.url).toBe('https://cdn/y.mp4');
    expect(s.log[0]!.body).toEqual({ text: 'a cat' });
  });

  it('fails permanently when the result has no video', async () => {
    const s = await serve(queue(['COMPLETED'], { other: 1 }));
    const err = await mk(s.origin).run(video, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
  });

  it('marks 429 retryable, 401 permanent, and hides the key', async () => {
    for (const [status, want] of [[429, true], [401, false]] as const) {
      const s = await serve(() => ({ status, body: { error: 'no' } }));
      const err = await mk(s.origin).run(video, new AbortController().signal).catch((e) => e);
      expect(err.retryable).toBe(want);
      expect(err.message).not.toContain('fal-secret');
      await close?.(); close = undefined;
    }
  });

  it('cancels the remote job when the wait times out', async () => {
    const s = await serve(queue(['IN_PROGRESS']));
    const err = await mk(s.origin, { timeoutMs: 0 }).run(video, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.log.some((r) => r.method === 'PUT' && r.url.endsWith('/cancel'))).toBe(true);
  });
});

describe('fal presets', () => {
  it('kling sends duration as a string and no resolution; wan sends a number and a resolution', async () => {
    const s = await serve(queue(['COMPLETED']));
    await mk(s.origin, { preset: 'kling-v3-standard' }).run(video, new AbortController().signal);
    expect(s.log[0]!.body).toEqual({ generate_audio: false, prompt: 'a cat', duration: '5', aspect_ratio: '9:16' });
    await mk(s.origin, { preset: 'wan-v2.7' }).run(video, new AbortController().signal);
    const wan = s.log.find((r, i) => r.method === 'POST' && i > 0)!;
    expect(wan.body).toEqual({ prompt: 'a cat', duration: 5, aspect_ratio: '9:16', resolution: '720p' });
  });

  it('rejects an unsupported duration locally and permanently, without calling fal', async () => {
    const s = await serve(queue(['COMPLETED']));
    const err = await mk(s.origin, { preset: 'kling-v3-standard' }).run({ ...video, durationSec: 2 }, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(s.log).toHaveLength(0);
  });

  it('refuses an unknown preset at construction and still lets extraInput win', async () => {
    expect(() => mk('http://x', { preset: 'nope' })).toThrow(/Unknown fal preset/);
    const s = await serve(queue(['COMPLETED']));
    await mk(s.origin, { preset: 'kling-v3-standard', extraInput: { duration: '10' } }).run(video, new AbortController().signal);
    expect(s.log[0]!.body.duration).toBe('10');
  });
});

describe('fal listed prices and errors', () => {
  const noPrice = (extra: object) => falVideo({ id: 'fal', label: 'fal', apiKey: 'k', model: 'x', baseUrl: 'http://x', ...extra } as any);
  it('uses the listed price when none is given: Kling $0.084/s, Wan $0.10 (720p) or $0.15 (1080p)', () => {
    const kling = noPrice({ preset: 'kling-v3-standard', model: 'fal-ai/kling-video/v3/standard/text-to-video' });
    expect(kling.estimate(video)).toBe(usd(5 * 0.084));
    const wan = noPrice({ preset: 'wan-v2.7', model: 'fal-ai/wan/v2.7/text-to-video' });
    expect(wan.estimate(video)).toBe(usd(5 * 0.1));
    expect(wan.estimate({ ...video, resolution: '1080p' })).toBe(usd(5 * 0.15));
  });
  it('an explicit price always wins', () => {
    expect(noPrice({ preset: 'wan-v2.7', model: 'fal-ai/wan/v2.7/text-to-video', usdPerSecond: 0.2 }).estimate(video)).toBe(usd(1));
  });
  it('refuses to guess: other model, or audio switched on, needs an explicit price', () => {
    expect(() => noPrice({ preset: 'kling-v3-standard', model: 'fal-ai/kling-video/v3/pro/text-to-video' })).toThrow(/no price known/);
    expect(() => noPrice({ preset: 'kling-v3-standard', model: 'fal-ai/kling-video/v3/standard/text-to-video', extraInput: { generate_audio: true } })).toThrow(/no price known/);
    expect(() => noPrice({})).toThrow(/no price known/);
  });
  it('rejects an over-long prompt locally', async () => {
    const s = await serve(queue(['COMPLETED']));
    const err = await mk(s.origin, { preset: 'kling-v3-standard' }).run({ ...video, prompt: 'x'.repeat(2501) }, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(s.log).toHaveLength(0);
  });
  it('a COMPLETED status carrying an error is a permanent failure, without fetching the result', async () => {
    const s = await serve((r, origin) => r.method === 'POST'
      ? { status: 200, body: { request_id: 'r', status_url: `${origin}/m/requests/r/status`, response_url: `${origin}/m/requests/r/response` } }
      : { status: 200, body: { status: 'COMPLETED', error: 'content policy violation', error_type: 'x' } });
    const err = await mk(s.origin).run(video, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('content policy');
    expect(s.log.some((r) => r.url.endsWith('/response'))).toBe(false);
  });
});
