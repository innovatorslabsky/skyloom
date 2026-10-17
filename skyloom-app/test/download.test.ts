import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadBatch, downloadVideo, saveVideoBytes } from '../electron/download.ts';
import type { BatchOutcome } from '../src/shared/api.ts';

let dir: string;
let close: (() => Promise<void>) | undefined;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'skyloom-dl-')); });
afterEach(async () => { await close?.(); close = undefined; await rm(dir, { recursive: true, force: true }); });

async function serve(h: (url: string) => { status: number; type?: string; body?: string; headers?: Record<string, string> }) {
  const server = createServer((rq, rs) => {
    const r = h(rq.url!);
    rs.writeHead(r.status, { ...(r.type ? { 'content-type': r.type } : {}), ...r.headers });
    rs.end(r.body ?? '');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const opt = { allowLoopbackHttp: true };

describe('downloadVideo', () => {
  it('saves a video with the extension from its content type and leaves no .part file', async () => {
    const o = await serve(() => ({ status: 200, type: 'video/webm', body: 'VIDEO' }));
    const p = await downloadVideo(`${o}/x`, join(dir, '001'), opt);
    expect(p.endsWith('001.webm')).toBe(true);
    expect(await readFile(p, 'utf8')).toBe('VIDEO');
    expect(await readdir(dir)).toEqual(['001.webm']);
  });
  it('refuses plain http to non-loopback hosts and http without the test flag', async () => {
    await expect(downloadVideo('http://example.com/v.mp4', join(dir, 'a'), opt)).rejects.toThrow(/https/);
    const o = await serve(() => ({ status: 200, type: 'video/mp4', body: 'x' }));
    await expect(downloadVideo(`${o}/v`, join(dir, 'a'))).rejects.toThrow(/https/);
  });
  it('rejects HTML error pages, HTTP errors, and oversize files', async () => {
    const o = await serve((u) => u === '/html' ? { status: 200, type: 'text/html', body: '<html>' } : u === '/404' ? { status: 404 } : { status: 200, type: 'video/mp4', body: 'x'.repeat(100) });
    await expect(downloadVideo(`${o}/html`, join(dir, 'a'), opt)).rejects.toThrow(/không phải video/);
    await expect(downloadVideo(`${o}/404`, join(dir, 'a'), opt)).rejects.toThrow(/HTTP 404/);
    await expect(downloadVideo(`${o}/big`, join(dir, 'a'), { ...opt, maxBytes: 10 })).rejects.toThrow(/giới hạn/);
    expect(await readdir(dir)).toEqual([]);
  });
  it('re-checks every redirect hop, so https cannot be downgraded to http', async () => {
    const o = await serve((u) => u === '/ok' ? { status: 200, type: 'video/mp4', body: 'v' } : u === '/bad' ? { status: 302, headers: { location: 'http://example.com/v.mp4' } } : { status: 302, headers: { location: '/ok' } });
    expect((await downloadVideo(`${o}/hop`, join(dir, 'a'), opt)).endsWith('a.mp4')).toBe(true);
    await expect(downloadVideo(`${o}/bad`, join(dir, 'b'), opt)).rejects.toThrow(/https/);
  });
});

describe('downloadBatch', () => {
  it('names files by item number, never from the URL, and records per-item failures', async () => {
    const o = await serve((u) => u === '/fail' ? { status: 500 } : { status: 200, type: 'video/mp4', body: u });
    const out: BatchOutcome = { spentMicro: 0, cancelled: false, items: [
      { idea: 'a', ok: true, mediaUrl: `${o}/../../evil.mp4` },
      { idea: 'b', ok: false, error: 'x' },
      { idea: 'c', ok: true, mediaUrl: `${o}/fail` },
      { idea: 'd', ok: true },
    ] };
    const res = await downloadBatch(out, dir, opt);
    expect(res.items[0]).toMatchObject({ file: 'videos/001.mp4' });
    expect(res.items[1]).toEqual(out.items[1]);
    expect(res.items[2]!.downloadError).toMatch(/HTTP 500/);
    expect(res.items[3]).toEqual(out.items[3]);
    expect(await readdir(join(dir, 'videos'))).toEqual(['001.mp4']);
  });
  it('does nothing (and creates no folder) when there is nothing to download', async () => {
    const out: BatchOutcome = { spentMicro: 0, cancelled: false, items: [{ idea: 'a', ok: false, error: 'x' }] };
    expect(await downloadBatch(out, dir, opt)).toBe(out);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('saveVideoBytes', () => {
  it('writes videos/NNN.<ext> atomically and enforces the size cap', async () => {
    expect(await saveVideoBytes(dir, 2, new TextEncoder().encode('abc'), 'video/webm')).toBe('videos/003.webm');
    expect(await readFile(join(dir, 'videos/003.webm'), 'utf8')).toBe('abc');
    expect(await readdir(join(dir, 'videos'))).toEqual(['003.webm']);
    await expect(saveVideoBytes(dir, 0, new Uint8Array(10), 'video/mp4', 5)).rejects.toThrow(/giới hạn/);
  });
});
