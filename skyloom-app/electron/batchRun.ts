import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkyloomService } from '../src/service.ts';
import type { BatchOutcome, BatchRequest } from '../src/shared/api.ts';
import { downloadBatch, saveVideoBytes } from './download.ts';
import type { DownloadOptions } from './download.ts';

export const newRunId = (now = new Date()): string => now.toISOString().replace(/[:.]/g, '-');

/**
 * Run a batch and keep everything under `<base>/<runId>/`: media in `videos/` or `images/` (inline results are written directly,
 * hosted ones downloaded) and a `batch.json` manifest. Shared by the desktop shell and the web server.
 */
export async function runToFolder(
  service: SkyloomService,
  req: BatchRequest,
  base: string,
  dl: DownloadOptions = {},
): Promise<(BatchOutcome & { runId: string; dir: string }) | { error: string }> {
  const runId = newRunId();
  const dir = join(base, runId);
  const subdir = req.mode === 'image' ? 'images' : 'videos';
  const out = await service.run(req, (i, bytes, mime) => saveVideoBytes(dir, i, bytes, mime, undefined, subdir));
  if ('error' in out) return out;
  const saved = await downloadBatch(out, dir, { ...dl, subdir });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'batch.json'), JSON.stringify({ request: req, outcome: saved }, null, 2));
  return { ...saved, runId, dir };
}
