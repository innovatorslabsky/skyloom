import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, createLimiter, hashPassword } from '../server/auth.ts';
import { createWebServer } from '../server/app.ts';
import { aesCipher } from '../server/crypto.ts';

const SECRET = 'x'.repeat(40);
let dir: string;
let base: string;
let closeServer: (() => Promise<void>) | undefined;
let nowMs = 1_800_000_000_000;

async function start(over: { password?: string } = {}) {
  dir = await mkdtemp(join(tmpdir(), 'sky-web-'));
  await mkdir(join(dir, 'static', 'assets'), { recursive: true });
  await writeFile(join(dir, 'static', 'index.html'), '<!doctype html><html><head><title>S</title></head><body></body></html>');
  await writeFile(join(dir, 'static', 'assets', 'a.js'), 'console.log(1)');
  const auth = createAuth({ user: 'owner', passwordHash: await hashPassword(over.password ?? 'correct horse battery'), secret: SECRET, now: () => nowMs });
  const { server } = createWebServer({ dataDir: join(dir, 'data'), staticDir: join(dir, 'static'), auth, secret: SECRET, serviceOptions: { demo: true, demoDelayMs: 1, retryBaseMs: 1 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
}
beforeEach(() => { nowMs = 1_800_000_000_000; });
afterEach(async () => { await closeServer?.(); closeServer = undefined; if (dir) await rm(dir, { recursive: true, force: true }); });

const XHR = { 'x-requested-with': 'skyloom', 'content-type': 'application/json' };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { ...XHR, ...headers }, body: JSON.stringify(body) });
async function login(headers: Record<string, string> = {}): Promise<string> {
  const r = await post('/api/login', { user: 'owner', password: 'correct horse battery' }, headers);
  expect(r.status).toBe(200);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}
const get = (path: string, cookie?: string, headers: Record<string, string> = {}) => fetch(base + path, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...headers } });

describe('auth gate', () => {
  it('serves health and login publicly, everything else needs a session', async () => {
    await start();
    expect((await get('/healthz')).status).toBe(200);
    expect((await get('/login')).status).toBe(200);
    expect((await get('/login.js')).status).toBe(200);
    const home = await get('/');
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/login');
    for (const p of ['/api/info', '/api/providers', '/api/history', '/api/events', '/assets/a.js', '/media/x/videos/001.mp4']) expect((await get(p)).status, p).toBe(401);
    expect((await post('/api/run', {})).status).toBe(401);
  });

  it('login sets an HttpOnly SameSite=Strict cookie (Secure behind https) and unlocks the app with the web-mode marker', async () => {
    await start();
    const r = await post('/api/login', { user: 'owner', password: 'correct horse battery' });
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Strict/); expect(c).not.toMatch(/Secure/);
    const secure = await post('/api/login', { user: 'owner', password: 'correct horse battery' }, { 'x-forwarded-proto': 'https' });
    expect(secure.headers.get('set-cookie')).toMatch(/Secure/);
    expect(secure.headers.get('strict-transport-security')).toBeTruthy();
    const cookie = c.split(';')[0]!;
    const html = await (await get('/', cookie)).text();
    expect(html).toContain('<meta name="skyloom-mode" content="web">');
    expect((await get('/assets/a.js', cookie)).status).toBe(200);
    expect(await (await get('/api/info', cookie)).json()).toEqual({ mode: 'web', secureKeys: true });
    const h = (await get('/', cookie)).headers;
    expect(h.get('content-security-policy')).toContain("default-src 'none'");
    expect(h.get('x-frame-options')).toBe('DENY');
  });

  it('rejects wrong credentials, then blocks the client after repeated failures', async () => {
    await start();
    expect((await post('/api/login', { user: 'owner', password: 'nope' })).status).toBe(401);
    expect((await post('/api/login', { user: 'someone', password: 'correct horse battery' })).status).toBe(401);
    expect((await post('/api/login', { user: 5, password: {} })).status).toBe(401);
    for (let i = 0; i < 6; i++) await post('/api/login', { user: 'owner', password: 'bad' + i });
    expect((await post('/api/login', { user: 'owner', password: 'correct horse battery' })).status).toBe(429); // even the right password
  });

  it('rejects forged, expired or tampered session cookies', async () => {
    await start();
    const cookie = await login();
    expect((await get('/api/info', cookie)).status).toBe(200);
    expect((await get('/api/info', cookie.slice(0, -2) + 'xx')).status).toBe(401);
    expect((await get('/api/info', 'sky_session=9999999999999.AAAA')).status).toBe(401);
    nowMs += 8 * 24 * 3600_000;
    expect((await get('/api/info', cookie)).status).toBe(401);
  });

  it('refuses state-changing calls without the custom header or from another origin (CSRF)', async () => {
    await start();
    const cookie = await login();
    const noHeader = await fetch(base + '/api/cancel', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    expect(noHeader.status).toBe(403);
    expect((await post('/api/cancel', {}, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/api/cancel', {}, { cookie, origin: base })).status).toBe(200);
    expect((await post('/api/login', { user: 'owner', password: 'correct horse battery' }, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('logout clears the cookie', async () => {
    await start();
    const r = await post('/api/logout', {});
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('rejects oversize and malformed bodies cleanly', async () => {
    await start();
    const cookie = await login();
    expect((await post('/api/estimate', { x: 'a'.repeat(3 * 1024 * 1024) }, { cookie })).status).toBe(413);
    const bad = await fetch(base + '/api/estimate', { method: 'POST', headers: { ...XHR, cookie }, body: '{not json' });
    expect(bad.status).toBe(400);
  });
});

describe('api', () => {
  it('stores provider keys encrypted and never returns them', async () => {
    await start();
    const cookie = await login();
    const saved = await (await post('/api/providers/save', { id: 'fal-img', label: 'img', kind: 'fal-image', baseUrl: '', model: '', apiKey: 'fal-very-secret' }, { cookie })).json();
    expect(saved).toEqual({ ok: true });
    const listed = JSON.stringify(await (await get('/api/providers', cookie)).json());
    expect(listed).toContain('fal-img');
    expect(listed).not.toContain('fal-very-secret');
    expect(await readFile(join(dir, 'data', 'config', 'keys.json'), 'utf8')).not.toContain('fal-very-secret');
    expect(await readFile(join(dir, 'data', 'config', 'providers.json'), 'utf8')).not.toContain('fal-very-secret');
    await post('/api/providers/remove', { id: 'fal-img' }, { cookie });
    expect(await (await get('/api/providers', cookie)).json()).toEqual([]);
  });

  it('runs a demo batch in the background, reports it, and lists it in history', async () => {
    await start();
    const cookie = await login();
    const req = { ideas: ['biển', 'núi'], durationSec: 4, aspect: '9:16', resolution: '720p', expandWithText: false, budgetUsd: 1, strategy: 'cheapest' };
    expect((await post('/api/estimate', req, { cookie }).then((r) => r.json())).ok).toBe(true);
    expect((await post('/api/run', { ...req, ideas: [] }, { cookie })).status).toBe(400);
    expect((await post('/api/run', req, { cookie })).status).toBe(202);
    expect((await post('/api/run', req, { cookie })).status).toBe(409); // already running
    let cur: any;
    for (let i = 0; i < 100; i++) { cur = await (await get('/api/run/current', cookie)).json(); if (cur.state !== 'running') break; await new Promise((r) => setTimeout(r, 50)); }
    expect(cur.state).toBe('done');
    expect(cur.outcome.items).toHaveLength(2);
    expect(cur.outcome.outputDir).toMatch(/^\d{4}-\d{2}-\d{2}T/); // a run id, not a server path
    expect(JSON.stringify(cur)).not.toContain(dir);
    const hist = (await (await get('/api/history', cookie)).json()) as Array<{ id: string; count: number }>;
    expect(hist[0]).toMatchObject({ id: cur.outcome.outputDir, count: 2 });
  });

  it('streams queue events over SSE to a logged-in client only', async () => {
    await start();
    const cookie = await login();
    const ac = new AbortController();
    const res = await fetch(base + '/api/events', { headers: { cookie }, signal: ac.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    await post('/api/run', { ideas: ['a'], durationSec: 4, aspect: '9:16', resolution: '720p', expandWithText: false, budgetUsd: 1, strategy: 'cheapest' }, { cookie });
    let text = '';
    const dec = new TextDecoder();
    for (let i = 0; i < 20 && !text.includes('"type":"done"'); i++) text += dec.decode((await reader.read()).value);
    expect(text).toContain('"type":"start"');
    expect(text).toContain('"type":"done"');
    ac.abort();
  });
});

describe('media', () => {
  const RUN = '2026-10-17T06-28-31-123Z';
  async function seed() {
    await mkdir(join(dir, 'data', 'runs', RUN, 'videos'), { recursive: true });
    await writeFile(join(dir, 'data', 'runs', RUN, 'videos', '001.mp4'), '0123456789');
    await writeFile(join(dir, 'data', 'runs', RUN, 'batch.json'), '{"secret":"do not serve"}');
  }
  it('serves saved files with types, ranges and a download option', async () => {
    await start(); await seed();
    const cookie = await login();
    const full = await get(`/media/${RUN}/videos/001.mp4`, cookie);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(await full.text()).toBe('0123456789');
    const part = await get(`/media/${RUN}/videos/001.mp4`, cookie, { range: 'bytes=2-4' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    expect((await get(`/media/${RUN}/videos/001.mp4`, cookie, { range: 'bytes=50-60' })).status).toBe(416);
    expect((await get(`/media/${RUN}/videos/001.mp4?download=1`, cookie)).headers.get('content-disposition')).toMatch(/^attachment/);
  });
  it('only serves the expected shapes: no traversal, no manifest, no other extensions', async () => {
    await start(); await seed();
    const cookie = await login();
    for (const p of [`/media/${RUN}/batch.json`, `/media/${RUN}/videos/../batch.json`, `/media/..%2F..%2Fconfig/videos/001.mp4`, `/media/${RUN}/videos/001.txt`, '/media/not-a-run/videos/001.mp4', `/media/${RUN}/videos/%2e%2e%2fbatch.json`, `/media/${RUN}/other/001.mp4`]) {
      expect((await get(p, cookie)).status, p).toBe(404);
    }
  });
});

describe('primitives', () => {
  it('aesCipher round-trips, uses a fresh IV, and fails closed on tampering or another secret', () => {
    const c = aesCipher(SECRET);
    const a = c.encrypt('sk-abc'), b = c.encrypt('sk-abc');
    expect(a.equals(b)).toBe(false);
    expect(c.decrypt(a)).toBe('sk-abc');
    const t = Buffer.from(a); t[t.length - 1]! ^= 1;
    expect(() => c.decrypt(t)).toThrow();
    expect(() => aesCipher('y'.repeat(40)).decrypt(a)).toThrow();
    expect(() => aesCipher('short')).toThrow(/32/);
  });
  it('createAuth demands a strong secret and a password', async () => {
    expect(() => createAuth({ user: 'a', password: 'x', secret: 'short' })).toThrow(/32/);
    expect(() => createAuth({ user: 'a', secret: SECRET })).toThrow(/PASSWORD/);
    const a = createAuth({ user: 'a', password: 'plain-pass', secret: SECRET });
    expect(await a.checkLogin('a', 'plain-pass')).toBe(true);
    expect(await a.checkLogin('a', 'plain-pasS')).toBe(false);
  });
  it('limiter forgets after its window', () => {
    let t = 0;
    const l = createLimiter(2, 1000, () => t);
    l.fail('ip'); l.fail('ip');
    expect(l.blocked('ip')).toBe(true);
    t = 1001;
    expect(l.blocked('ip')).toBe(false);
  });
});
