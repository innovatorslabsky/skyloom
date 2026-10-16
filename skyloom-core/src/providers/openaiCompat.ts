import { ProviderError } from '../types.ts';
import type { Call, MicroUsd, Output, Provider } from '../types.ts';

export interface OpenAiCompatConfig {
  id: string;
  label: string;
  /** e.g. an OpenAI-compatible endpoint such as NVIDIA's hosted catalog. Confirm the current URL on the provider's site. */
  baseUrl: string;
  /** The user's own key. Never logged, never persisted by this library. */
  apiKey: string;
  model: string;
  rpm?: number;
  maxConcurrent?: number;
  /** USD per 1M tokens; 0/undefined for a free tier. */
  usdPerMillionIn?: number;
  usdPerMillionOut?: number;
  fetch?: typeof fetch;
}

const retryAfter = (h: string | null): number | undefined => {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s) * 1000;
  const t = Date.parse(h);
  return Number.isNaN(t) ? undefined : Math.max(0, t - Date.now());
};

/** Text provider for any chat-completions compatible API: used to expand ideas into scene prompts. */
export function openAiCompatText(c: OpenAiCompatConfig): Provider {
  const f = c.fetch ?? fetch;
  const inPrice = c.usdPerMillionIn ?? 0;
  const outPrice = c.usdPerMillionOut ?? 0;
  return {
    id: c.id,
    label: c.label,
    kinds: ['text'],
    ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
    maxConcurrent: c.maxConcurrent ?? 2,
    estimate(call: Call): MicroUsd {
      if (call.kind !== 'text') return 0;
      const inTok = Math.ceil((call.prompt.length + (call.system?.length ?? 0)) / 4);
      const outTok = call.maxTokens ?? 512;
      return Math.round(inTok * inPrice + outTok * outPrice); // (tokens × USD/1M) → micro-USD
    },
    async run(call: Call, signal: AbortSignal): Promise<Output> {
      if (call.kind !== 'text') throw new ProviderError(`${c.id} only serves text.`, { retryable: false });
      let res: Response;
      try {
        res = await f(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
          body: JSON.stringify({
            model: c.model,
            max_tokens: call.maxTokens ?? 512,
            messages: [...(call.system ? [{ role: 'system', content: call.system }] : []), { role: 'user', content: call.prompt }],
          }),
        });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ProviderError(`Network error calling ${c.id}.`, { retryable: true, cause: e });
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
        const after = retryAfter(res.headers.get('retry-after'));
        // Body is read only for a short, key-free hint; the request (with the key) is never echoed.
        const hint = (await res.text().catch(() => '')).slice(0, 200);
        throw new ProviderError(`${c.id} returned HTTP ${res.status}: ${hint}`, { retryable, status: res.status, ...(after !== undefined ? { retryAfterMs: after } : {}) });
      }
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = j.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new ProviderError(`${c.id} returned no text.`, { retryable: false });
      return { text, ...(j.usage?.prompt_tokens !== undefined ? { inputTokens: j.usage.prompt_tokens } : {}), ...(j.usage?.completion_tokens !== undefined ? { outputTokens: j.usage.completion_tokens } : {}) };
    },
  };
}
