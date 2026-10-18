import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry, HistoryItem } from '../src/shared/api.ts';

/** Batch folders are named from an ISO timestamp with ':' and '.' replaced by '-', e.g. 2026-10-17T06-28-31-123Z. */
export const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const text = (v: unknown, max = 2000): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const runIdToDate = (id: string): string => id.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');

/** Folder of a run, only if `id` has the exact shape we create (so a renderer-supplied id can never point elsewhere). */
export const runDir = (base: string, id: unknown): string | undefined => (typeof id === 'string' && RUN_ID.test(id) ? join(base, id) : undefined);

/**
 * Read past runs from `<base>/<run>/batch.json`. Files are user-editable, so every field is type-checked and only known fields are
 * kept; a broken or oversized file is skipped rather than failing the whole list.
 */
export async function listHistory(base: string, limit = 100): Promise<HistoryEntry[]> {
  let names: string[];
  try { names = await readdir(base); } catch { return []; }
  const ids = names.filter((n) => RUN_ID.test(n)).sort().reverse().slice(0, limit);
  const out: HistoryEntry[] = [];
  for (const id of ids) {
    const file = join(base, id, 'batch.json');
    try {
      if ((await stat(file)).size > MAX_MANIFEST_BYTES) continue;
      const j = JSON.parse(await readFile(file, 'utf8')) as { outcome?: { items?: unknown; spentMicro?: unknown; cancelled?: unknown } };
      const raw = Array.isArray(j.outcome?.items) ? (j.outcome!.items as unknown[]) : [];
      const items: HistoryItem[] = raw.slice(0, 500).map((r) => {
        const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
        const provider = text(o.provider, 100), file = text(o.file, 300), error = text(o.error) ?? text(o.downloadError), cost = num(o.costMicro);
        return { idea: text(o.idea) ?? '', ok: o.ok === true, ...(provider ? { provider } : {}), ...(cost !== undefined ? { costMicro: cost } : {}), ...(file ? { file } : {}), ...(error ? { error } : {}) };
      });
      out.push({ id, createdAt: runIdToDate(id), count: items.length, okCount: items.filter((i) => i.ok).length, spentMicro: num(j.outcome?.spentMicro) ?? 0, cancelled: j.outcome?.cancelled === true, items });
    } catch { /* unreadable or not JSON: skip */ }
  }
  return out;
}
