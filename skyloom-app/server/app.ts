import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { SkyloomService, validateBatch } from '../src/service.ts';
import type { ServiceOptions } from '../src/service.ts';
import type { AppInfo, BatchOutcome, BatchRequest, ProviderInput } from '../src/shared/api.ts';
import { runToFolder } from '../electron/batchRun.ts';
import type { DownloadOptions } from '../electron/download.ts';
import { listHistory, RUN_ID } from '../electron/history.ts';
import { encryptedKeyStore, jsonConfigStore } from '../electron/stores.ts';
import type { createAuth } from './auth.ts';
import { createLimiter, parseCookies } from './auth.ts';
import { aesCipher } from './crypto.ts';
import { LOGIN_CSS, LOGIN_HTML, LOGIN_JS } from './loginPage.ts';

export interface WebServerOptions {
  /** Persistent folder (a Railway volume): `config/` holds providers and encrypted keys, `runs/` holds finished batches. */
  dataDir: string;
  /** Folder with the built renderer (index.html + assets/). */
  staticDir: string;
  auth: ReturnType<typeof createAuth>;
  /** Same secret as the auth one; also keys the API-key encryption. */
  secret: string;
  /** Tests only. */
  serviceOptions?: Partial<ServiceOptions>;
  download?: DownloadOptions;
}

const MAX_BODY = 2 * 1024 * 1024;
const COOKIE = 'sky_session';
const MEDIA_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const ASSET_TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json' };
/** Brand files that the login page needs before anyone is signed in. They hold nothing private. */
const PUBLIC_FILES: Record<string, string> = { '/favicon.svg': 'image/svg+xml', '/favicon.ico': 'image/x-icon', '/apple-touch-icon.png': 'image/png', '/logo-mark.svg': 'image/svg+xml' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

type Current = { state: 'idle' } | { state: 'running'; startedAt: number } | { state: 'done'; outcome: BatchOutcome } | { state: 'error'; error: string };

export function createWebServer(o: WebServerOptions): { server: Server; service: SkyloomService } {
  const cfgDir = join(o.dataDir, 'config');
  const runsDir = join(o.dataDir, 'runs');
  const sse = new Set<ServerResponse>();
  const broadcast = (e: unknown) => { const line = `data: ${JSON.stringify(e)}\n\n`; for (const r of sse) r.write(line); };
  const service = new SkyloomService({
    keys: encryptedKeyStore(cfgDir, aesCipher(o.secret)),
    config: jsonConfigStore(cfgDir),
    onEvent: broadcast,
    ...o.serviceOptions,
  });
  const ipLimiter = createLimiter(8);
  const globalLimiter = createLimiter(60); // blunts a spread-out guessing attempt that rotates client addresses
  let current: Current = { state: 'idle' };
  let indexHtml: string | undefined;

  const clientId = (req: IncomingMessage): string => {
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return xff.at(-1) ?? req.socket.remoteAddress ?? 'unknown'; // last hop = the proxy's view of the caller; earlier ones are client-supplied
  };
  const isHttps = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || Boolean((req.socket as { encrypted?: boolean } | null)?.encrypted);

  function baseHeaders(req: IncomingMessage): Record<string, string> {
    return {
      'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'cross-origin-opener-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      ...(isHttps(req) ? { 'strict-transport-security': 'max-age=31536000' } : {}),
    };
  }
  function send(req: IncomingMessage, res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { ...baseHeaders(req), 'content-type': type, 'cache-control': 'no-store', ...extra });
    res.end(body);
  }
  const json = (req: IncomingMessage, res: ServerResponse, status: number, v: unknown, extra: Record<string, string> = {}) => send(req, res, status, JSON.stringify(v), 'application/json; charset=utf-8', extra);

  async function readJson(req: IncomingMessage): Promise<unknown> {
    if (Number(req.headers['content-length']) > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of req) {
      n += (c as Buffer).length;
      if (n > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(c as Buffer);
    }
    try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
  }
  /** State-changing calls must come from our own page: custom header (not sendable cross-site without CORS) plus same-host Origin. */
  function sameSiteOk(req: IncomingMessage): boolean {
    if (req.headers['x-requested-with'] !== 'skyloom') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  async function serveMedia(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
    const m = /^\/media\/([^/]+)\/(videos|images)\/(\d{3}\.(?:mp4|webm|mov|jpg|png|webp))$/.exec(path);
    if (!m || !RUN_ID.test(m[1]!)) return json(req, res, 404, { error: 'Không tìm thấy.' });
    const file = join(runsDir, m[1]!, m[2]!, m[3]!);
    let size: number;
    try { size = (await stat(file)).size; } catch { return json(req, res, 404, { error: 'Không tìm thấy.' }); }
    const type = MEDIA_TYPES[extname(file)] ?? 'application/octet-stream';
    let start = 0, end = size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } else { start = Math.max(0, size - Number(range[2])); }
      if (start > end || start >= size) { res.writeHead(416, { ...baseHeaders(req), 'content-range': `bytes */${size}` }); return void res.end(); }
      status = 206;
    }
    res.writeHead(status, {
      ...baseHeaders(req), 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'cache-control': 'private, max-age=3600',
      'content-disposition': `${query.get('download') === '1' ? 'attachment' : 'inline'}; filename="${m[3]}"`,
      ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const name = /^\/assets\/([A-Za-z0-9._-]+)$/.exec(path)?.[1];
    if (!name) return json(req, res, 404, { error: 'Không tìm thấy.' });
    try {
      const buf = await readFile(join(o.staticDir, 'assets', name));
      send(req, res, 200, buf, ASSET_TYPES[extname(name)] ?? 'application/octet-stream', { 'cache-control': 'private, max-age=86400' });
    } catch { json(req, res, 404, { error: 'Không tìm thấy.' }); }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // ---- public
    if (path === '/healthz') return send(req, res, 200, 'ok', 'text/plain');
    if (method === 'GET' && PUBLIC_FILES[path]) {
      try { return send(req, res, 200, await readFile(join(o.staticDir, path.slice(1))), PUBLIC_FILES[path]!, { 'cache-control': 'public, max-age=86400' }); }
      catch { return json(req, res, 404, { error: 'Không tìm thấy.' }); }
    }
    if (method === 'GET' && path === '/login') return send(req, res, 200, LOGIN_HTML, 'text/html; charset=utf-8');
    if (method === 'GET' && path === '/login.css') return send(req, res, 200, LOGIN_CSS, 'text/css; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
    if (method === 'GET' && path === '/login.js') return send(req, res, 200, LOGIN_JS, 'text/javascript; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
    if (method === 'POST' && path === '/api/login') {
      if (!sameSiteOk(req)) return json(req, res, 403, { error: 'Yêu cầu không hợp lệ.' });
      const id = clientId(req);
      if (ipLimiter.blocked(id) || globalLimiter.blocked('all')) return json(req, res, 429, { error: 'Thử lại sau.' }, { 'retry-after': '900' });
      const b = (await readJson(req)) as { user?: unknown; password?: unknown };
      const ok = typeof b.user === 'string' && typeof b.password === 'string' && b.user.length < 200 && b.password.length < 500 && (await o.auth.checkLogin(b.user, b.password));
      if (!ok) { ipLimiter.fail(id); globalLimiter.fail('all'); return json(req, res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' }); }
      ipLimiter.ok(id);
      const s = o.auth.newSession();
      return json(req, res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${s.maxAgeSec}${isHttps(req) ? '; Secure' : ''}` });
    }
    if (method === 'POST' && path === '/api/logout') {
      if (!sameSiteOk(req)) return json(req, res, 403, { error: 'Yêu cầu không hợp lệ.' });
      return json(req, res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isHttps(req) ? '; Secure' : ''}` });
    }

    // ---- everything below needs a valid session
    if (!o.auth.checkSession(parseCookies(req.headers.cookie)[COOKIE])) {
      if (method === 'GET' && (path === '/' || path === '/index.html')) { res.writeHead(302, { ...baseHeaders(req), location: '/login', 'cache-control': 'no-store' }); return void res.end(); }
      return json(req, res, 401, { error: 'Chưa đăng nhập.' });
    }
    if (method === 'GET' || method === 'HEAD') {
      if (path === '/' || path === '/index.html') {
        indexHtml ??= (await readFile(join(o.staticDir, 'index.html'), 'utf8')).replace('<head>', '<head>\n  <meta name="skyloom-mode" content="web">');
        return send(req, res, 200, indexHtml, 'text/html; charset=utf-8');
      }
      if (path.startsWith('/assets/')) return serveStatic(req, res, path);
      if (path.startsWith('/media/')) return serveMedia(req, res, path, url.searchParams);
      if (path === '/api/info') return json(req, res, 200, { mode: 'web', secureKeys: true } satisfies AppInfo);
      if (path === '/api/providers') return json(req, res, 200, await service.listProviders());
      if (path === '/api/history') return json(req, res, 200, await listHistory(runsDir));
      if (path === '/api/run/current') return json(req, res, 200, current);
      if (path === '/api/events') {
        if (sse.size >= 20) return json(req, res, 503, { error: 'Quá nhiều kết nối.' });
        res.writeHead(200, { ...baseHeaders(req), 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': ok\n\n');
        sse.add(res);
        const beat = setInterval(() => res.write(': \n\n'), 20_000);
        req.on('close', () => { clearInterval(beat); sse.delete(res); });
        return;
      }
      return json(req, res, 404, { error: 'Không tìm thấy.' });
    }
    if (method === 'POST') {
      if (!sameSiteOk(req)) return json(req, res, 403, { error: 'Yêu cầu không hợp lệ.' });
      if (path === '/api/providers/save') return json(req, res, 200, await service.saveProvider((await readJson(req)) as ProviderInput));
      if (path === '/api/providers/remove') { const b = (await readJson(req)) as { id?: unknown }; await service.removeProvider(String(b.id ?? '')); return json(req, res, 200, { ok: true }); }
      if (path === '/api/estimate') return json(req, res, 200, await service.estimate((await readJson(req)) as BatchRequest));
      if (path === '/api/cancel') { await service.cancel(); return json(req, res, 200, { ok: true }); }
      if (path === '/api/run') {
        const r = (await readJson(req)) as BatchRequest;
        const bad = validateBatch(r);
        if (bad) return json(req, res, 400, { error: bad });
        if (current.state === 'running') return json(req, res, 409, { error: 'Đang có một lô chạy. Hãy chờ hoặc huỷ trước.' });
        current = { state: 'running', startedAt: Date.now() };
        // Runs in the background: a batch outlives any single HTTP request, and the page polls /api/run/current.
        void runToFolder(service, r, runsDir, o.download).then(
          (out) => {
            if ('error' in out) { current = { state: 'error', error: out.error }; return; }
            // Never expose server paths: the page only needs the run id (for /media links) and the per-item results.
            const { dir: _dir, runId, ...outcome } = out;
            current = { state: 'done', outcome: { ...outcome, outputDir: runId } };
          },
          (e: unknown) => { console.error('batch failed:', (e as Error).message); current = { state: 'error', error: 'Lô chạy bị lỗi ngoài ý muốn.' }; },
        );
        return json(req, res, 202, { ok: true });
      }
    }
    return json(req, res, 404, { error: 'Không tìm thấy.' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: { status?: number; message?: string }) => {
      if (res.headersSent) return void res.destroy();
      if (e.status === 413 || e.status === 400) {
        // Answer first, then drop the connection so an oversize upload cannot keep streaming into the server.
        json(req, res, e.status, { error: e.status === 413 ? 'Dữ liệu quá lớn.' : 'Dữ liệu không hợp lệ.' }, { connection: 'close' });
        if (e.status === 413) res.on('finish', () => req.destroy());
        return;
      }
      console.error(`${req.method} ${req.url?.split('?')[0]} failed:`, e.message); // message only: never request bodies, which can hold API keys
      json(req, res, 500, { error: 'Lỗi máy chủ.' });
    });
  });
  server.requestTimeout = 0; // SSE and slow uploads are bounded elsewhere
  return { server, service };
}
