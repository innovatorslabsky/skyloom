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
const mk = (baseUrl: string, extra = {}) => geminiOmniVideo({ id: 'omni', label: 'Omni', apiKey: 'g-secret', usdPerSecond: 0.1, baseUrl, ...extra });
const b64 = Buffer.from('MP4DATA').toString('base64');
const inline = { steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: b64 }] }] };

describe('geminiOmniVideo', () => {
  it('posts model+input to /v1beta/interactions with the key in a header, and decodes inline base64 video', async () => {
    const s = await serve(() => ({ status: 200, body: inline }));
    const out = await mk(s.base).run(video, new AbortController().signal);
    expect(Buffer.from(out.media!.bytes!).toString()).toBe('MP4DATA');
    expect(out.media!.mime).toBe('video/mp4');
    expect(s.seen[0]).toMatchObject({ method: 'POST', url: '/v1beta/interactions', key: 'g-secret', body: { model: 'gemini-omni-1.1-flash', input: 'a marble' } });
    expect(s.seen[0]!.url).not.toContain('g-secret');
  });
  it('merges extraBody but never lets it replace model or input', async () => {
    const s = await serve(() => ({ status: 200, body: inline }));
    await mk(s.base, { extraBody: { response_format: { duration: 8 }, model: 'evil', input: 'evil' } }).run(video, new AbortController().signal);
    expect(s.seen[0]!.body).toEqual({ response_format: { duration: 8 }, model: 'gemini-omni-1.1-flash', input: 'a marble' });
  });
  it('accepts a uri-style video anywhere in the response', async () => {
    const s = await serve(() => ({ status: 200, body: { a: { b: [{ mimeType: 'video/mp4', uri: 'https://x/v.mp4' }] } } }));
    expect((await mk(s.base).run(video, new AbortController().signal)).media).toEqual({ url: 'https://x/v.mp4', mime: 'video/mp4' });
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
