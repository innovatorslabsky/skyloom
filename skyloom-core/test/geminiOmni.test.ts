import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError, findVideo, geminiOmniVideo, usd } from '../src/index.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
interface Seen { method: string; url: string; key?: string; body: any }
async function serve(reply: (b: any) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const server = createServer((rq, rs) => {
    let raw = '';
    rq.on('data', (d) => (raw += d));
    rq.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ method: rq.method!, url: rq.url!, key: rq.headers['x-goog-api-key'] as string | undefined, body });
      const r = reply(body);
      rs.writeHead(r.status, { 'content-type': 'application/json' });
      rs.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise((r) => server.close(() => r()));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}
const video = { kind: 'video', prompt: 'a marble', durationSec: 5, aspect: '9:16', resolution: '720p' } as const;
const mk = (baseUrl: string, extra = {}) => geminiOmniVideo({ id: 'omni', label: 'Omni', apiKey: 'g-secret', usdPerSecond: 0.1, baseUrl, delivery: 'inline', pollIntervalMs: 1, sleep: async () => {}, ...extra });
const b64 = Buffer.from('MP4DATA').toString('base64');
const inline = { steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: b64 }] }] };

describe('geminiOmniVideo', () => {
  it('posts model+input to /v1beta/interactions with the key in a header, and decodes inline base64 video', async () => {
    const s = await serve(() => ({ status: 200, body: inline }));
    const out = await mk(s.base).run(video, new AbortController().signal);
    expect(Buffer.from(out.media!.bytes!).toString()).toBe('MP4DATA');
    expect(out.media!.mime).toBe('video/mp4');
    expect(s.seen[0]).toMatchObject({ method: 'POST', url: '/v1beta/interactions', key: 'g-secret' });
    expect(s.seen[0]!.body).toEqual({
      background: false, store: false, stream: false,
      response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p' },
      model: 'gemini-omni-1.1-flash', input: 'a marble',
    });
    expect(s.seen[0]!.url).not.toContain('g-secret');
  });
  it('merges extraBody but never lets it replace model or input', async () => {
    const s = await serve(() => ({ status: 200, body: inline }));
    await mk(s.base, { extraBody: { response_format: { type: 'video', resolution: '360p' }, model: 'evil', input: 'evil' } }).run(video, new AbortController().signal);
    expect(s.seen[0]!.body.response_format).toEqual({ type: 'video', resolution: '360p' });
    expect(s.seen[0]!.body).toMatchObject({ model: 'gemini-omni-1.1-flash', input: 'a marble' });
  });
  it('sends delivery:uri by default, polls the file until ACTIVE, then downloads it with the key', async () => {
    const files: string[] = [];
    let polls = 0;
    const seen: Array<{ url: string; key?: string }> = [];
    let base = '';
    const server = createServer((rq, rs) => {
      rq.resume();
      rq.on('end', () => {
        seen.push({ url: rq.url!, key: rq.headers['x-goog-api-key'] as string | undefined });
        if (rq.method === 'POST') { rs.setHeader('content-type', 'application/json'); return void rs.end(JSON.stringify({ steps: [{ content: [{ type: 'video', mime_type: 'video/mp4', uri: `${base}/v1beta/files/abc123:download?alt=media` }] }] })); }
        if (rq.url === '/v1beta/files/abc123') { rs.setHeader('content-type', 'application/json'); return void rs.end(JSON.stringify({ state: ++polls < 3 ? 'PROCESSING' : 'ACTIVE' })); }
        rs.end('BIGVIDEO');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => new Promise((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    files.push(base);
    let posted: any;
    const f: typeof fetch = async (u, init) => { if (init?.method === 'POST') posted = JSON.parse(String(init.body)); return fetch(u, init); };
    const out = await mk(base, { delivery: undefined, fetch: f }).run(video, new AbortController().signal);
    expect(posted.response_format).toMatchObject({ type: 'video', delivery: 'uri' });
    expect(Buffer.from(out.media!.bytes!).toString()).toBe('BIGVIDEO');
    expect(polls).toBe(3);
    expect(seen.every((x) => x.key === 'g-secret')).toBe(true);
    expect(seen.at(-1)!.url).toBe('/v1beta/files/abc123:download?alt=media');
  });
  it('never sends the key to a video address on another host', async () => {
    const s = await serve(() => ({ status: 200, body: { x: { mime_type: 'video/mp4', uri: 'https://evil.example/v1beta/files/zzz:download' } } }));
    const err = await mk(s.base, { delivery: 'uri' }).run(video, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/another host/);
    expect(s.seen).toHaveLength(1);
  });
  it('a FAILED hosted file is a permanent error', async () => {
    let base = '';
    const server = createServer((rq, rs) => { rq.resume(); rq.on('end', () => { rs.setHeader('content-type', 'application/json'); rs.end(rq.method === 'POST' ? JSON.stringify({ x: { mime_type: 'video/mp4', uri: `${base}/v1beta/files/q1:download` } }) : JSON.stringify({ state: 'FAILED' })); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => new Promise((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const err = await mk(base, { delivery: 'uri' }).run(video, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/FAILED/);
  });
  it('rejects 1:1 locally because Google documents only 9:16 and 16:9', async () => {
    const s = await serve(() => ({ status: 200, body: inline }));
    const err = await mk(s.base).run({ ...video, aspect: '1:1' }, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(s.seen).toHaveLength(0);
  });
  it('reports a missing video permanently, naming only top-level keys', async () => {
    const s = await serve(() => ({ status: 200, body: { steps: [{ content: [{ type: 'text', text: 'secret prose' }] }], id: 1 } }));
    const err = await mk(s.base).run(video, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('steps, id');
    expect(err.message).not.toContain('secret prose');
  });
  it('429 is retryable, 400/403 permanent, and the key never appears in errors', async () => {
    for (const [status, want] of [[429, true], [503, true], [400, false], [403, false]] as const) {
      const s = await serve(() => ({ status, body: { error: 'no' } }));
      const err = await mk(s.base).run(video, new AbortController().signal).catch((e) => e);
      expect(err.retryable).toBe(want);
      expect(err.message).not.toContain('g-secret');
      await close?.(); close = undefined;
    }
  });
  it('rejects oversize inline video', async () => {
    const s = await serve(() => ({ status: 200, body: inline }));
    const err = await mk(s.base, { maxResponseBytes: 3 }).run(video, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
  });
  it('prices by requested seconds, or by fixedSeconds when the model ignores the request', () => {
    expect(mk('http://x').estimate(video)).toBe(usd(0.5));
    expect(mk('http://x', { fixedSeconds: 10 }).estimate(video)).toBe(usd(1));
    expect(mk('http://x').estimate({ kind: 'text', prompt: 'x' })).toBe(0);
  });
  it('findVideo ignores non-video mime types and empty data', () => {
    expect(findVideo({ mime_type: 'image/png', data: 'abc' })).toBeUndefined();
    expect(findVideo({ mime_type: 'video/mp4', data: '' })).toBeUndefined();
  });
});
