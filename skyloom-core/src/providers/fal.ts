import { pollUntilDone } from '../poll.ts';
import type { PollState } from '../poll.ts';
import type { Sleep } from '../sync.ts';
import { ProviderError } from '../types.ts';
import type { Call, MicroUsd, Output, Provider, VideoCall } from '../types.ts';
import { usd } from '../types.ts';

export interface FalVideoConfig {
  id: string;
  label: string;
  /** The user's own fal key. Sent as `Authorization: Key …`; never logged or echoed. */
  apiKey: string;
  /** fal model endpoint id, e.g. "fal-ai/…/text-to-video". Pick it from the model's page on fal. */
  model: string;
  /** USD per second of video for this model. Read it from the model's page; prices differ per model and resolution. */
  usdPerSecond: number;
  /** Default https://queue.fal.run */
  baseUrl?: string;
  /** Request body for this model. Parameter names differ per model, so override this when the default does not fit. */
  buildInput?: (call: VideoCall) => Record<string, unknown>;
  /** Pull the video URL out of the result. Default looks for `video.url`, then `videos[0].url`. */
  extractUrl?: (result: unknown) => string | undefined;
  rpm?: number;
  maxConcurrent?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: Sleep;
}

const defaultInput = (c: VideoCall): Record<string, unknown> => ({
  prompt: c.prompt,
  duration: c.durationSec,
  aspect_ratio: c.aspect,
  resolution: c.resolution,
  ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
});

const defaultExtract = (r: unknown): string | undefined => {
  const o = r as { video?: { url?: unknown }; videos?: Array<{ url?: unknown }> } | null;
  const u = o?.video?.url ?? o?.videos?.[0]?.url;
  return typeof u === 'string' ? u : undefined;
};

const retryable = (s: number) => s === 429 || s === 408 || s >= 500;

/**
 * Video provider for fal's queue API: submit a job, poll its status, fetch the result.
 * Status and result URLs come from the submit response (so model sub-paths are handled by fal),
 * but are only followed when they stay on the configured host, so the key is never sent elsewhere.
 */
export function falVideo(c: FalVideoConfig): Provider {
  const f = c.fetch ?? fetch;
  const base = (c.baseUrl ?? 'https://queue.fal.run').replace(/\/$/, '');
  const origin = new URL(base).origin;
  const headers = { 'content-type': 'application/json', authorization: `Key ${c.apiKey}` };
  const build = c.buildInput ?? defaultInput;
  const extract = c.extractUrl ?? defaultExtract;

  async function http(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await f(url, { ...init, signal, headers });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ProviderError(`Network error calling ${c.id}.`, { retryable: true, cause: e });
    }
    if (!res.ok) {
      const hint = (await res.text().catch(() => '')).slice(0, 200);
      throw new ProviderError(`${c.id} returned HTTP ${res.status}: ${hint}`, { retryable: retryable(res.status), status: res.status });
    }
    return res.json().catch(() => { throw new ProviderError(`${c.id} returned invalid JSON.`, { retryable: true }); });
  }
  const sameHost = (u: unknown): u is string => {
    if (typeof u !== 'string') return false;
    try { return new URL(u).origin === origin; } catch { return false; }
  };

  return {
    id: c.id,
    label: c.label,
    kinds: ['video'],
    ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
    maxConcurrent: c.maxConcurrent ?? 2,
    estimate(call: Call): MicroUsd {
      return call.kind === 'video' ? usd(call.durationSec * c.usdPerSecond) : 0;
    },
    async run(call: Call, signal: AbortSignal): Promise<Output> {
      if (call.kind !== 'video') throw new ProviderError(`${c.id} only serves video.`, { retryable: false });
      const sub = (await http(`${base}/${c.model}`, { method: 'POST', body: JSON.stringify(build(call)) }, signal)) as
        { request_id?: string; status_url?: unknown; response_url?: unknown; cancel_url?: unknown };
      if (!sub.request_id || !sameHost(sub.status_url) || !sameHost(sub.response_url)) {
        throw new ProviderError(`${c.id} returned an unexpected submit response.`, { retryable: false });
      }
      const { status_url: statusUrl, response_url: responseUrl } = sub as { status_url: string; response_url: string };
      try {
        await pollUntilDone<true>(async (): Promise<PollState<true>> => {
          const s = (await http(statusUrl, { method: 'GET' }, signal)) as { status?: string };
          if (s.status === 'COMPLETED') return { done: true, value: true };
          return { done: false }; // IN_QUEUE / IN_PROGRESS
        }, { intervalMs: c.pollIntervalMs ?? 3000, timeoutMs: c.timeoutMs ?? 10 * 60_000, signal, ...(c.sleep ? { sleep: c.sleep } : {}) });
      } catch (e) {
        // Stop paying for a job we no longer wait on (abort or timeout). Best effort only.
        if (sameHost(sub.cancel_url)) void f(sub.cancel_url, { method: 'PUT', headers }).catch(() => undefined);
        throw e;
      }
      const result = await http(responseUrl, { method: 'GET' }, signal);
      const url = extract(result);
      if (!url) throw new ProviderError(`${c.id} finished without a video URL.`, { retryable: false });
      return { media: { url, mime: 'video/mp4' } };
    },
  };
}
