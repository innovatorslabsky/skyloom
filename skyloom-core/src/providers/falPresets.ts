import { ProviderError } from '../types.ts';
import type { VideoCall } from '../types.ts';

/**
 * Per-model request shapes for fal video endpoints. Parameter names and types differ per model, so each preset says how
 * to build that model's body. Prices are deliberately NOT here: they change, so the user enters them from the model page.
 * `verified` says how the shape was established; nothing here has been run against the live service.
 */
export interface FalPreset {
  id: string;
  label: string;
  /** Suggested fal endpoint id; the user can change it (e.g. standard → pro). */
  model: string;
  /** Inclusive range of whole seconds the model accepts. */
  seconds: readonly [number, number];
  /** Send `duration` as a string ("5") or a number (5). */
  durationType: 'string' | 'number';
  /** Send a `resolution` field (only for models that have one). */
  resolution: boolean;
  source: string;
  verified: 'fal docs page (via search summary)' | 'partly inferred';
}

export const FAL_PRESETS: readonly FalPreset[] = [
  {
    id: 'kling-v3-standard', label: 'Kling v3 Standard', model: 'fal-ai/kling-video/v3/standard/text-to-video',
    seconds: [3, 15], durationType: 'string', resolution: false,
    source: 'https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/api', verified: 'fal docs page (via search summary)',
  },
  {
    id: 'wan-v2.7', label: 'Wan 2.7', model: 'fal-ai/wan/v2.7/text-to-video',
    seconds: [2, 15], durationType: 'number', resolution: true,
    source: 'https://fal.ai/models/fal-ai/wan/v2.7/text-to-video/api', verified: 'partly inferred', // duration type not confirmed
  },
];

export const falPreset = (id: string): FalPreset | undefined => FAL_PRESETS.find((p) => p.id === id);

/** Build the request body for a preset. Out-of-range durations fail locally and permanently, instead of paying for a 422 round trip. */
export function presetInput(p: FalPreset, c: VideoCall): Record<string, unknown> {
  const d = c.durationSec;
  if (!Number.isInteger(d) || d < p.seconds[0] || d > p.seconds[1]) {
    throw new ProviderError(`${p.label} accepts ${p.seconds[0]}–${p.seconds[1]} whole seconds, got ${d}.`, { retryable: false });
  }
  return {
    prompt: c.prompt,
    duration: p.durationType === 'string' ? String(d) : d,
    aspect_ratio: c.aspect,
    ...(p.resolution ? { resolution: c.resolution } : {}),
    ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
  };
}
