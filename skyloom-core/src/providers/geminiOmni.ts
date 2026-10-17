import { pollUntilDone } from '../poll.ts';
import type { PollState } from '../poll.ts';
import type { Sleep } from '../sync.ts';
import { ProviderError, usd } from '../types.ts';
import type { Call, MicroUsd, Output, Provider } from '../types.ts';

export interface GeminiOmniConfig {
  id: string;
  label: string;
  /** The user's own Gemini API key. Sent in the `x-goog-api-key` header, never in the URL, so it cannot leak through logs or error text. */
  apiKey: string;
  /** Default "gemini-omni-1.1-flash". */
  model?: string;
  /** USD per second of video, from Google's pricing page. */
  usdPerSecond: number;
  /**
   * Seconds billed per clip when the model makes clips of a fixed length regardless of the request.
   * When set, estimates use this instead of the requested duration so the budget cap stays honest.
   */
  fixedSeconds?: number;
  /**
   * How the finished video comes back. "uri" (default) returns a Google-hosted file that this provider polls until ACTIVE and then downloads
   * with the key; Google recommends it for videos over 4 MB. "inline" returns base64 in the response (4 MB payload limit).
   */
  delivery?: 'uri' | 'inline';
  /** Merged over the default request body (but never over `model` and `input`), e.g. `{ response_format: { resolution: "360p" } }`. */
  extraBody?: Record<string, unknown>;
  pollIntervalMs?: number;
  sleep?: Sleep;
  /** Default https://generativelanguage.googleapis.com */
  baseUrl?: string;
  rpm?: number;
  maxConcurrent?: number;
  timeoutMs?: number;
  /** Cap on the response body, bytes. Default 256 MiB. */
  maxResponseBytes?: number;
  fetch?: typeof fetch;
}

interface Found { mime: string; data?: string; url?: string }

/** The response layout is not pinned down, so search the whole JSON for a video content item (inline base64 `data`, or a `uri`/`url`). */
export function findVideo(node: unknown, depth = 0): Found | undefined {
  if (depth > 12 || node === null || typeof node !== 'object') return undefined;
  const o = node as Record<string, unknown>;
  const mime = o.mime_type ?? o.mimeType;
  if (typeof mime === 'string' && mime.startsWith('video/')) {
    if (typeof o.data === 'string' && o.data.length > 0) return { mime, data: o.data };
    const u = o.uri ?? o.url;
    if (typeof u === 'string') return { mime, url: u };
  }
  for (const v of Array.isArray(node) ? node : Object.values(o)) {
    const r = findVideo(v, depth + 1);
    if (r) return r;
  }
  return undefined;
}

/** Google documents 9:16 and 16:9 only. */
const ASPECTS = new Set(['9:16', '16:9']);

function decodeBase64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Video via the Gemini Interactions API: one POST, the video comes back in the response (no job to poll). */
export function geminiOmniVideo(c: GeminiOmniConfig): Provider {
  const f = c.fetch ?? fetch;
  const base = (c.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const model = c.model ?? 'gemini-omni-1.1-flash';
  const maxBytes = c.maxResponseBytes ?? 256 * 1024 ** 2;
  return {
    id: c.id,
    label: c.label,
    kinds: ['video'],
    ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
    maxConcurrent: c.maxConcurrent ?? 2,
    estimate(call: Call): MicroUsd {
      return call.kind === 'video' ? usd((c.fixedSeconds ?? call.durationSec) * c.usdPerSecond) : 0;
    },
    async run(call: Call, signal: AbortSignal): Promise<Output> {
      if (call.kind !== 'video') throw new ProviderError(`${c.id} only serves video.`, { retryable: false });
      if (!ASPECTS.has(call.aspect)) throw new ProviderError(`${c.id} supports only 9:16 and 16:9, got ${call.aspect}.`, { retryable: false });
      const sig = AbortSignal.any([signal, AbortSignal.timeout(c.timeoutMs ?? 10 * 60_000)]);
      const delivery = c.delivery ?? 'uri';
      const headers = { 'content-type': 'application/json', 'x-goog-api-key': c.apiKey };
      const http = async (url: string, init: RequestInit): Promise<Response> => {
        let res: Response;
        try { res = await f(url, { ...init, signal: sig, headers }); } catch (e) {
          if (signal.aborted) throw e;
          throw new ProviderError(`Network error calling ${c.id}.`, { retryable: true, cause: e });
        }
        if (!res.ok) {
          const hint = (await res.text().catch(() => '')).slice(0, 200);
          throw new ProviderError(`${c.id} returned HTTP ${res.status}: ${hint}`, { retryable: res.status === 429 || res.status === 408 || res.status >= 500, status: res.status });
        }
        const len = Number(res.headers.get('content-length'));
        if (Number.isFinite(len) && len > maxBytes) { await res.body?.cancel(); throw new ProviderError(`${c.id} response is larger than the allowed size.`, { retryable: false }); }
        return res;
      };
      // Synchronous, unstored generation is what Google's docs recommend for speed; we never edit a clip afterwards.
      const res = await http(`${base}/v1beta/interactions`, {
        method: 'POST',
        body: JSON.stringify({
          background: false, store: false, stream: false,
          response_format: { type: 'video', aspect_ratio: call.aspect, resolution: call.resolution, ...(delivery === 'uri' ? { delivery: 'uri' } : {}) },
          ...c.extraBody, model, input: call.prompt,
        }),
      });
      const sameHost = (u: string) => { try { return new URL(u).origin === new URL(base).origin; } catch { return false; } };
      /** A hosted file: wait until it is ACTIVE, then download it. Both calls carry the key, so they only go to the configured host. */
      const fetchFile = async (uri: string): Promise<Uint8Array> => {
        if (!sameHost(uri)) throw new ProviderError(`${c.id} returned a video address on another host; refusing to send the key there.`, { retryable: false });
        const id = /\/files\/([A-Za-z0-9_-]+)/.exec(uri)?.[1];
        if (id) {
          await pollUntilDone<true>(async (): Promise<PollState<true>> => {
            const info = (await (await http(`${base}/v1beta/files/${id}`, { method: 'GET' })).json().catch(() => ({}))) as { state?: unknown };
            const st = typeof info.state === 'string' ? info.state : (info.state as { name?: string } | undefined)?.name;
            if (st === 'ACTIVE') return { done: true, value: true };
            if (st === 'FAILED') return { done: true, error: `${c.id}: Google reported the video file as FAILED.` };
            return { done: false };
          }, { intervalMs: c.pollIntervalMs ?? 5000, timeoutMs: c.timeoutMs ?? 10 * 60_000, signal: sig, ...(c.sleep ? { sleep: c.sleep } : {}) });
        }
        const buf = new Uint8Array(await (await http(uri, { method: 'GET' })).arrayBuffer());
        if (buf.length > maxBytes) throw new ProviderError(`${c.id} video is larger than the allowed size.`, { retryable: false });
        return buf;
      };
      let json: unknown;
      try { json = await res.json(); } catch (e) { throw new ProviderError(`${c.id} returned invalid JSON.`, { retryable: true, cause: e }); }
      const v = findVideo(json);
      if (!v) {
        // Name the top-level keys only: enough to debug a layout change, without echoing generated content.
        const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 10).join(', ') : typeof json;
        throw new ProviderError(`${c.id} finished without a video (response keys: ${keys}).`, { retryable: false });
      }
      if (v.url) return { media: { bytes: await fetchFile(v.url), mime: v.mime } };
      const bytes = decodeBase64(v.data!);
      if (bytes.length > maxBytes) throw new ProviderError(`${c.id} video is larger than the allowed size.`, { retryable: false });
      return { media: { bytes, mime: v.mime } };
    },
  };
}
