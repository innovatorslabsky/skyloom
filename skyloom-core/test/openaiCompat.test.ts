import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError, openAiCompatText } from '../src/index.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function serve(handler: (body: any, auth: string | undefined) => { status: number; body: unknown; headers?: Record<string, string> }) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const r = handler(raw ? JSON.parse(raw) : {}, req.headers.authorization);
      res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}
const mk = (baseUrl: string) => openAiCompatText({ id: 'nim', label: 'NIM', baseUrl, apiKey: 'sk-secret', model: 'm', usdPerMillionIn: 0, usdPerMillionOut: 0 });
const call = { kind: 'text', prompt: 'a cat', system: 'be brief' } as const;

describe('openAiCompatText', () => {
  it('sends the user key and parses text and usage', async () => {
    let seen: any, auth: string | undefined;
    const url = await serve((b, a) => { seen = b; auth = a; return { status: 200, body: { choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } } }; });
    const out = await mk(url).run(call, new AbortController().signal);
    expect(out).toEqual({ text: 'hello', inputTokens: 3, outputTokens: 1 });
    expect(auth).toBe('Bearer sk-secret');
    expect(seen.messages.map((m: any) => m.role)).toEqual(['system', 'user']);
  });

  it('marks 429 retryable and reads Retry-After seconds', async () => {
    const url = await serve(() => ({ status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '7' } }));
    const err = await mk(url).run(call, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(7000);
  });

  it('treats 401 as permanent and never leaks the key in the error', async () => {
    const url = await serve(() => ({ status: 401, body: { error: 'bad key' } }));
    const err = await mk(url).run(call, new AbortController().signal).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(err.message).not.toContain('sk-secret');
  });

  it('estimates 0 on a free tier and scales with price otherwise', () => {
    expect(mk('http://x').estimate({ kind: 'text', prompt: 'x'.repeat(400), maxTokens: 100 })).toBe(0);
    const paid = openAiCompatText({ id: 'p', label: 'P', baseUrl: 'http://x', apiKey: 'k', model: 'm', usdPerMillionIn: 1, usdPerMillionOut: 2 });
    expect(paid.estimate({ kind: 'text', prompt: 'x'.repeat(400), maxTokens: 100 })).toBe(100 * 1 + 100 * 2);
  });
});
