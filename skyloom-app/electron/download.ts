import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BatchOutcome, ItemOutcome } from '../src/shared/api.ts';

export interface DownloadOptions {
  fetch?: typeof fetch;
  /** Per-file cap. Default 1 GiB. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Tests only: allow http://127.0.0.1. Real downloads are https only. */
  allowLoopbackHttp?: boolean;
  /** Folder under the batch folder. Default `videos`; stills use `images`. */
  subdir?: string;
  signal?: AbortSignal;
}

const EXT: Record<string, string> = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

function checkUrl(u: URL, o: DownloadOptions): void {
  if (u.username || u.password) throw new Error('Địa chỉ video chứa tài khoản/mật khẩu.');
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && o.allowLoopbackHttp && isLoopback(u.hostname)) return;
  throw new Error('Chỉ tải video qua https.');
}

/** Download one video to `<destNoExt><ext>`; returns the final path. Writes to a .part file and renames, so no half-files remain. */
export async function downloadVideo(url: string, destNoExt: string, o: DownloadOptions = {}): Promise<string> {
  const f = o.fetch ?? fetch;
  const max = o.maxBytes ?? 1024 ** 3;
  const signal = AbortSignal.any([AbortSignal.timeout(o.timeoutMs ?? 10 * 60_000), ...(o.signal ? [o.signal] : [])]);
  let cur = new URL(url);
  let res: Response | undefined;
  for (let hop = 0; hop <= 3; hop++) {
    checkUrl(cur, o); // every redirect hop is re-checked, so https cannot be downgraded
    res = await f(cur, { signal, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) break;
    await res.body?.cancel();
    cur = new URL(loc, cur);
    res = undefined;
  }
  if (!res) throw new Error('Quá nhiều lần chuyển hướng.');
  if (!res.ok || !res.body) throw new Error(`Tải video thất bại (HTTP ${res.status}).`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type && !type.startsWith('video/') && !type.startsWith('image/') && type !== 'application/octet-stream') {
    await res.body.cancel();
    throw new Error(`Nơi lưu trả về "${type}", không phải video hoặc ảnh.`);
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { await res.body.cancel(); throw new Error('Video lớn hơn giới hạn cho phép.'); }
  const dest = `${destNoExt}${EXT[type] ?? (type.startsWith('image/') ? '.jpg' : '.mp4')}`;
  const part = `${dest}.part`;
  let n = 0;
  const cap = new Transform({ transform(chunk: Buffer, _e, cb) { n += chunk.length; n > max ? cb(new Error('Video lớn hơn giới hạn cho phép.')) : cb(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(res.body as never), cap, createWriteStream(part, { flags: 'wx' }), { signal });
    await rename(part, dest);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
  return dest;
}

/** Save a video that arrived inline as bytes. Same size cap and naming as downloads; returns the path relative to the batch folder. */
export async function saveVideoBytes(dir: string, index: number, bytes: Uint8Array, mime: string, maxBytes = 1024 ** 3, subdir = 'videos'): Promise<string> {
  if (bytes.length > maxBytes) throw new Error('Video lớn hơn giới hạn cho phép.');
  const vdir = join(dir, subdir);
  await mkdir(vdir, { recursive: true });
  const rel = `${subdir}/${String(index + 1).padStart(3, '0')}${EXT[mime.toLowerCase()] ?? '.mp4'}`;
  const part = join(dir, `${rel}.part`);
  await writeFile(part, bytes, { flag: 'wx' });
  await rename(part, join(dir, rel));
  return rel;
}

/** Save every finished item's video under `<dir>/videos/NN.<ext>`. File names never come from the URL. Failures are recorded per item. */
export async function downloadBatch(out: BatchOutcome, dir: string, o: DownloadOptions = {}): Promise<BatchOutcome> {
  const sub = o.subdir ?? 'videos';
  const vdir = join(dir, sub);
  const items: ItemOutcome[] = [...out.items];
  const todo = items.map((it, i) => ({ it, i })).filter((x) => x.it.ok && x.it.mediaUrl && !x.it.file);
  if (todo.length === 0) return out;
  await mkdir(vdir, { recursive: true });
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < todo.length; k = next++) {
      const { it, i } = todo[k]!;
      const name = String(i + 1).padStart(3, '0');
      try {
        const path = await downloadVideo(it.mediaUrl!, join(vdir, name), o);
        items[i] = { ...it, file: `${sub}/${path.split(/[\\/]/).pop()}` };
      } catch (e) {
        items[i] = { ...it, downloadError: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
  return { ...out, items };
}
