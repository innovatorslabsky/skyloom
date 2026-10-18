import { ProviderError } from '../types.ts';
import type { VideoCall } from '../types.ts';

/**
 * Per-model request shapes for fal video endpoints, taken from each model's own machine-readable page
 * (https://fal.ai/models/<id>/llms.txt and its OpenAPI schema) on 2026-10-17.
 * Parameter names, types and prices differ per model, so each preset says how to build that model's body.
 * Nothing here has been run against the live service with a real key.
 */
export interface FalPreset {
  id: string;
  label: string;
  /** Suggested fal endpoint id; the user can change it, but then the built-in prices no longer apply. */
  model: string;
  /** Inclusive range of whole seconds the model accepts. */
  seconds: readonly [number, number];
  /** Send `duration` as a string ("5") or a number (5). */
  durationType: 'string' | 'number';
  /** Send a `resolution` field (only for models that have one). */
  resolution: boolean;
  /** Longest prompt the model accepts. */
  maxPrompt: number;
  /** Fixed body fields sent by default (the user's extra parameters can override them). */
  fields: Record<string, unknown>;
  /** USD per second as listed by fal, by resolution; `default` when price does not depend on it. */
  usdPerSecond: { default?: number; '720p'?: number; '1080p'?: number };
  /** The listed prices only hold while these body fields keep these values; if the user overrides one, they must enter a price. */
  priceAssumes: Record<string, unknown>;
  source: string;
}

export const FAL_PRESETS: readonly FalPreset[] = [
  {
    id: 'kling-v3-standard', label: 'Kling v3 Standard', model: 'fal-ai/kling-video/v3/standard/text-to-video',
    seconds: [3, 15], durationType: 'string', resolution: false, maxPrompt: 2500,
    // fal lists $0.084/s with audio off and $0.126/s with audio on; audio defaults to ON at fal, so we turn it off explicitly.
    fields: { generate_audio: false }, usdPerSecond: { default: 0.084 }, priceAssumes: { generate_audio: false },
    source: 'https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/llms.txt',
  },
  {
    id: 'wan-v2.7', label: 'Wan 2.7', model: 'fal-ai/wan/v2.7/text-to-video',
    seconds: [2, 15], durationType: 'number', resolution: true, maxPrompt: 5000,
    fields: {}, usdPerSecond: { '720p': 0.1, '1080p': 0.15 }, priceAssumes: {},
    source: 'https://fal.ai/models/fal-ai/wan/v2.7/text-to-video/llms.txt',
  },
];

export const falPreset = (id: string): FalPreset | undefined => FAL_PRESETS.find((p) => p.id === id);

/** Listed price for a clip, or undefined when the preset's price table does not apply (other model, or a price-changing field overridden). */
export function presetUsdPerSecond(p: FalPreset, model: string, extra: Record<string, unknown> | undefined, resolution: string): number | undefined {
  if (model !== p.model) return undefined;
  for (const [k, v] of Object.entries(p.priceAssumes)) if (extra && k in extra && extra[k] !== v) return undefined;
  return p.usdPerSecond[resolution as '720p' | '1080p'] ?? p.usdPerSecond.default;
}
/** True when every resolution the app can ask for has a listed price. */
export const presetCanPrice = (p: FalPreset, model: string, extra?: Record<string, unknown>): boolean =>
  (['720p', '1080p'] as const).every((r) => presetUsdPerSecond(p, model, extra, r) !== undefined);

/** Build the request body for a preset. Out-of-range durations or over-long prompts fail locally and permanently, instead of paying for a 422 round trip. */
export function presetInput(p: FalPreset, c: VideoCall): Record<string, unknown> {
  const d = c.durationSec;
  if (!Number.isInteger(d) || d < p.seconds[0] || d > p.seconds[1]) {
    throw new ProviderError(`${p.label} accepts ${p.seconds[0]}–${p.seconds[1]} whole seconds, got ${d}.`, { retryable: false });
  }
  if (c.prompt.length > p.maxPrompt) throw new ProviderError(`${p.label} accepts prompts up to ${p.maxPrompt} characters, got ${c.prompt.length}.`, { retryable: false });
  return {
    ...p.fields,
    prompt: c.prompt,
    duration: p.durationType === 'string' ? String(d) : d,
    aspect_ratio: c.aspect,
    ...(p.resolution ? { resolution: c.resolution } : {}),
    ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
  };
}
