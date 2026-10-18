import { createFalQueue } from './falQueue.ts';
import type { Sleep } from '../sync.ts';
import { ProviderError } from '../types.ts';
import { falPreset, presetInput, presetUsdPerSecond } from './falPresets.ts';
import type { Call, MicroUsd, Output, Provider, VideoCall } from '../types.ts';
import { usd } from '../types.ts';

export interface FalVideoConfig {
  id: string;
  label: string;
  /** The user's own fal key. Sent as `Authorization: Key …`; never logged or echoed. */
  apiKey: string;
  /** fal model endpoint id, e.g. "fal-ai/…/text-to-video". Pick it from the model's page on fal. */
  model: string;
  /**
   * USD per second of video, flat. Optional when `preset` has listed prices for this exact model; give it when you change the model,
   * switch a price-changing option (e.g. Kling audio), or want your own rate.
   */
  usdPerSecond?: number;
  /** Default https://queue.fal.run */
  baseUrl?: string;
  /** Id of a built-in model preset (see FAL_PRESETS) that decides the request shape. */
  preset?: string;
  /** Request body for this model. Parameter names differ per model, so override this when the default does not fit. */
  buildInput?: (call: VideoCall) => Record<string, unknown>;
  /** Extra body fields merged over the default request (e.g. a model's own parameters). Ignored when `buildInput` is set. */
  extraInput?: Record<string, unknown>;
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

/**
 * Video provider for fal's queue API: submit a job, poll its status, fetch the result.
 * Status and result URLs come from the submit response (so model sub-paths are handled by fal),
 * but are only followed when they stay on the configured host, so the key is never sent elsewhere.
 */
export function falVideo(c: FalVideoConfig): Provider {
  const preset = c.preset ? falPreset(c.preset) : undefined;
  if (c.preset && !preset) throw new Error(`Unknown fal preset "${c.preset}".`);
  const rate = (v: VideoCall): number => {
    const r = c.usdPerSecond ?? (preset ? presetUsdPerSecond(preset, c.model, c.extraInput, v.resolution) : undefined);
    if (r === undefined) throw new Error(`${c.id}: no price known. Enter the USD per second for ${c.model}.`);
    return r;
  };
  // Fail at construction, not mid-batch, when a price cannot be determined for either resolution the app offers.
  if (c.usdPerSecond === undefined) for (const resolution of ['720p', '1080p'] as const) rate({ kind: 'video', prompt: '', durationSec: 1, aspect: '16:9', resolution });
  const base0 = (v: VideoCall) => (preset ? presetInput(preset, v) : defaultInput(v));
  const build = c.buildInput ?? ((v: VideoCall) => ({ ...base0(v), ...c.extraInput }));
  const extract = c.extractUrl ?? defaultExtract;

  const queue = createFalQueue(c);

  return {
    id: c.id,
    label: c.label,
    kinds: ['video'],
    ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
    maxConcurrent: c.maxConcurrent ?? 2,
    estimate(call: Call): MicroUsd {
      return call.kind === 'video' ? usd(call.durationSec * rate(call)) : 0;
    },
    async run(call: Call, signal: AbortSignal): Promise<Output> {
      if (call.kind !== 'video') throw new ProviderError(`${c.id} only serves video.`, { retryable: false });
      const result = await queue.run(c.model, build(call), signal);
      const url = extract(result);
      if (!url) throw new ProviderError(`${c.id} finished without a video URL.`, { retryable: false });
      return { media: { url, mime: 'video/mp4' } };
    },
  };
}
