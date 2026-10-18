import { pollUntilDone } from '../poll.ts';
import type { PollState } from '../poll.ts';
import type { Sleep } from '../sync.ts';
import { ProviderError } from '../types.ts';

export interface FalQueueConfig {
  id: string;
  /** The user's own fal key, sent as `Authorization: Key …`; never logged or echoed. */
  apiKey: string;
  /** Default https://queue.fal.run */
  baseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: Sleep;
}

const retryable = (s: number) => s === 429 || s === 408 || s >= 500;

/**
 * fal's queue protocol, shared by the video and image providers: submit, poll status until COMPLETED, fetch the result JSON.
 * Status/result/cancel URLs come from the submit response (so model sub-paths are handled by fal) but are only followed when they stay on
 * the configured host, so the key is never sent elsewhere. A request that ends COMPLETED with an `error` is a permanent failure.
 * On abort or timeout the remote job is cancelled (best effort) so we stop paying for work nobody waits on.
 */
export function createFalQueue(c: FalQueueConfig) {
  const f = c.fetch ?? fetch;
  const base = (c.baseUrl ?? 'https://queue.fal.run').replace(/\/$/, '');
  const origin = new URL(base).origin;
  const headers = { 'content-type': 'application/json', authorization: `Key ${c.apiKey}` };

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
    async run(model: string, body: unknown, signal: AbortSignal): Promise<unknown> {
      const sub = (await http(`${base}/${model}`, { method: 'POST', body: JSON.stringify(body) }, signal)) as
        { request_id?: string; status_url?: unknown; response_url?: unknown; cancel_url?: unknown };
      if (!sub.request_id || !sameHost(sub.status_url) || !sameHost(sub.response_url)) {
        throw new ProviderError(`${c.id} returned an unexpected submit response.`, { retryable: false });
      }
      const { status_url: statusUrl, response_url: responseUrl } = sub as { status_url: string; response_url: string };
      try {
        await pollUntilDone<true>(async (): Promise<PollState<true>> => {
          const s = (await http(statusUrl, { method: 'GET' }, signal)) as { status?: string; error?: unknown };
          if (s.status === 'COMPLETED') {
            if (typeof s.error === 'string' && s.error) return { done: true, error: `${c.id}: ${s.error.slice(0, 200)}` };
            return { done: true, value: true };
          }
          return { done: false }; // IN_QUEUE / IN_PROGRESS
        }, { intervalMs: c.pollIntervalMs ?? 3000, timeoutMs: c.timeoutMs ?? 10 * 60_000, signal, ...(c.sleep ? { sleep: c.sleep } : {}) });
      } catch (e) {
        if (sameHost(sub.cancel_url)) void f(sub.cancel_url, { method: 'PUT', headers }).catch(() => undefined);
        throw e;
      }
      return http(responseUrl, { method: 'GET' }, signal);
    },
  };
}
