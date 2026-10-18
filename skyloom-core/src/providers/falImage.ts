import { ProviderError, usd } from '../types.ts';
import type { Call, ImageCall, MicroUsd, Output, Provider } from '../types.ts';
import type { Sleep } from '../sync.ts';
import { createFalQueue } from './falQueue.ts';

/** Model with a price taken from fal's own model page on 2026-10-17: $0.003 per megapixel. */
export const FLUX_SCHNELL = { model: 'fal-ai/flux/schnell', usdPerMegapixel: 0.003, source: 'https://fal.ai/models/fal-ai/flux/schnell/llms.txt' } as const;

export interface FalImageConfig {
  id: string;
  label: string;
  apiKey: string;
  /** Default `fal-ai/flux/schnell`. */
  model?: string;
  /** USD per megapixel. Optional only for the default model (listed price); required for any other model. */
  usdPerMegapixel?: number;
  /** Merged over the request body (never over `prompt`), e.g. `{ num_inference_steps: 4, output_format: "png" }`. */
  extraInput?: Record<string, unknown>;
  baseUrl?: string;
  rpm?: number;
  maxConcurrent?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: Sleep;
}

const DEFAULT_SIZE = 1024;
const megapixels = (c: ImageCall) => ((c.width ?? DEFAULT_SIZE) * (c.height ?? DEFAULT_SIZE)) / 1e6;

/** Pull the first image out of a fal image result (`images[0].url`). */
export function findImage(result: unknown): { url: string; mime: string } | undefined {
  const img = (result as { images?: Array<{ url?: unknown; content_type?: unknown }> } | null)?.images?.[0];
  if (!img || typeof img.url !== 'string') return undefined;
  return { url: img.url, mime: typeof img.content_type === 'string' && img.content_type.startsWith('image/') ? img.content_type : 'image/jpeg' };
}

/** Image provider for fal's queue API (one image per call). Sizes are sent as `{width, height}`; the cost is per megapixel. */
export function falImage(c: FalImageConfig): Provider {
  const model = c.model ?? FLUX_SCHNELL.model;
  const rate = c.usdPerMegapixel ?? (model === FLUX_SCHNELL.model ? FLUX_SCHNELL.usdPerMegapixel : undefined);
  if (rate === undefined) throw new Error(`${c.id}: no price known. Enter the USD per megapixel for ${model}.`);
  const queue = createFalQueue(c);
  return {
    id: c.id,
    label: c.label,
    kinds: ['image'],
    ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
    maxConcurrent: c.maxConcurrent ?? 3,
    estimate(call: Call): MicroUsd {
      return call.kind === 'image' ? usd(megapixels(call) * rate) : 0;
    },
    async run(call: Call, signal: AbortSignal): Promise<Output> {
      if (call.kind !== 'image') throw new ProviderError(`${c.id} only serves images.`, { retryable: false });
      const result = await queue.run(model, {
        num_images: 1,
        image_size: { width: call.width ?? DEFAULT_SIZE, height: call.height ?? DEFAULT_SIZE },
        ...c.extraInput,
        prompt: call.prompt,
      }, signal);
      const img = findImage(result);
      if (!img) throw new ProviderError(`${c.id} finished without an image URL.`, { retryable: false });
      return { media: { url: img.url, mime: img.mime } };
    },
  };
}
