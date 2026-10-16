import type { Aspect, QueueEvent, Strategy } from 'skyloom-core';

/** Stored in plain JSON. Deliberately has no key field: keys live in the OS-encrypted key store. */
export interface ProviderConfig {
  id: string;
  label: string;
  kind: 'openai-compat-text' | 'fal-video';
  /** For fal-video, empty means the default https://queue.fal.run. */
  baseUrl: string;
  model: string;
  rpm?: number;
  usdPerMillionIn?: number;
  usdPerMillionOut?: number;
  /** fal-video: USD per second of video, from the model's page. */
  usdPerSecond?: number;
  /** fal-video: built-in model preset id (request shape and allowed durations). Empty = generic shape. */
  preset?: string;
  /** fal-video: extra request fields specific to the model. */
  extraInput?: Record<string, unknown>;
}
/** Only ever sent renderer → main, once, when saving. */
export interface ProviderInput extends ProviderConfig { apiKey: string }

export interface BatchRequest {
  ideas: string[];
  durationSec: number;
  aspect: Aspect;
  resolution: '720p' | '1080p';
  expandWithText: boolean;
  budgetUsd: number;
  strategy: Strategy;
}
export type EstimateResult = { ok: true; perItem: number; total: number; text: string } | { ok: false; error: string };

export interface ItemOutcome { idea: string; ok: boolean; error?: string; provider?: string; costMicro?: number; prompt?: string; mediaUrl?: string;
  /** Path of the saved video relative to the batch folder (desktop only). */
  file?: string; downloadError?: string }
export interface BatchOutcome { items: ItemOutcome[]; spentMicro: number; cancelled: boolean; outputDir?: string }

export interface AppInfo { mode: 'desktop' | 'demo'; secureKeys: boolean; note?: string }

/** The only surface the renderer can use. Everything else (keys, network, disk) stays in the main process. */
export interface SkyloomApi {
  info(): Promise<AppInfo>;
  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(p: ProviderInput): Promise<{ ok: true } | { ok: false; error: string }>;
  removeProvider(id: string): Promise<void>;
  estimate(req: BatchRequest): Promise<EstimateResult>;
  run(req: BatchRequest): Promise<BatchOutcome | { error: string }>;
  cancel(): Promise<void>;
  onEvent(cb: (e: QueueEvent) => void): () => void;
}
declare global {
  interface Window { skyloom?: SkyloomApi }
}
