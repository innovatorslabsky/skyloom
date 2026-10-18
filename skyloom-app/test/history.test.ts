import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listHistory, runDir, runIdToDate } from '../electron/history.ts';

let base: string;
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'sky-h-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });
const run = async (id: string, content: unknown) => { await mkdir(join(base, id), { recursive: true }); await writeFile(join(base, id, 'batch.json'), typeof content === 'string' ? content : JSON.stringify(content)); };

describe('listHistory', () => {
  it('lists runs newest first with counts, spend and per-item details', async () => {
    await run('2026-10-16T01-00-00-000Z', { outcome: { spentMicro: 100, items: [{ idea: 'a', ok: true, provider: 'p', costMicro: 100, file: 'videos/001.mp4' }] } });
    await run('2026-10-17T06-28-31-123Z', { outcome: { spentMicro: 600000, cancelled: false, items: [{ idea: 'x', ok: true, provider: 'fal', costMicro: 200000, file: 'videos/001.mp4' }, { idea: 'y', ok: false, error: 'boom' }] } });
    const h = await listHistory(base);
    expect(h.map((e) => e.id)).toEqual(['2026-10-17T06-28-31-123Z', '2026-10-16T01-00-00-000Z']);
    expect(h[0]).toMatchObject({ createdAt: '2026-10-17T06:28:31.123Z', count: 2, okCount: 1, spentMicro: 600000, cancelled: false });
    expect(h[0]!.items[1]).toEqual({ idea: 'y', ok: false, error: 'boom' });
  });
  it('skips broken/oversize files and unrelated folders, keeps only known typed fields', async () => {
    await run('2026-10-17T00-00-00-000Z', 'not json');
    await run('2026-10-17T00-00-01-000Z', { outcome: { items: [{ idea: 5, ok: 'yes', provider: { x: 1 }, costMicro: 'a', file: ['x'], secret: 'k' }, null, 7], spentMicro: 'x' } });
    await mkdir(join(base, 'random-folder'));
    await run('2026-10-17T00-00-02-000Z', { outcome: { items: 'nope' } });
    const h = await listHistory(base);
    expect(h.map((e) => e.id)).toEqual(['2026-10-17T00-00-02-000Z', '2026-10-17T00-00-01-000Z']);
    expect(h[1]!.items).toEqual([{ idea: '', ok: false }, { idea: '', ok: false }, { idea: '', ok: false }]);
    expect(h[1]!.spentMicro).toBe(0);
    expect(JSON.stringify(h)).not.toContain('"k"');
    expect(h[0]!.count).toBe(0);
  });
  it('returns [] when the folder does not exist yet, and respects the limit', async () => {
    expect(await listHistory(join(base, 'nope'))).toEqual([]);
    for (let i = 0; i < 5; i++) await run(`2026-10-17T00-00-0${i}-000Z`, { outcome: { items: [] } });
    expect(await listHistory(base, 2)).toHaveLength(2);
  });
});

describe('runDir', () => {
  it('only accepts the exact folder-name shape (no traversal)', () => {
    expect(runDir('/b', '2026-10-17T06-28-31-123Z')).toBe(join('/b', '2026-10-17T06-28-31-123Z'));
    for (const bad of ['..', '../x', '/etc', '2026-10-17T06-28-31-123Z/../..', '', 5, null]) expect(runDir('/b', bad)).toBeUndefined();
    expect(runIdToDate('2026-10-17T06-28-31-123Z')).toBe('2026-10-17T06:28:31.123Z');
  });
});
