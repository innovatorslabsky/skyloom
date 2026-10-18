/** Money is tracked as integer micro-USD so sums never drift. */
export type MicroUsd = number;
export const usd = (dollars: number): MicroUsd => Math.round(dollars * 1_000_000);
export const formatUsd = (m: MicroUsd): string => `$${(m / 1_000_000).toFixed(m < 10_000 ? 4 : 2)}`;

export type Kind = 'text' | 'image' | 'video';
export type Aspect = '9:16' | '16:9' | '1:1';

export interface TextCall { kind: 'text'; prompt: string; system?: string; maxTokens?: number }
export interface ImageCall { kind: 'image'; prompt: string; width?: number; height?: number }
export interface VideoCall {
  kind: 'video';
  prompt: string;
  durationSec: number;
  aspect: Aspect;
  resolution: '720p' | '1080p';
  /** Optional first frame (image-to-video). */
  imageUrl?: string;
}
export type Call = TextCall | ImageCall | VideoCall;

export interface Media { url?: string; bytes?: Uint8Array; mime: string }
export interface Output { text?: string; media?: Media; inputTokens?: number; outputTokens?: number }

export interface Provider {
  id: string;
  label: string;
  kinds: readonly Kind[];
  /** Requests per minute this provider allows for the user's key. Unlimited when absent. */
  rpm?: number;
  /** Calls allowed in flight at once. Default 1. */
  maxConcurrent?: number;
  /** Estimated cost of one call, before running it. 0 for free tiers. */
  estimate(call: Call): MicroUsd;
  run(call: Call, signal: AbortSignal): Promise<Output>;
}

/** Thrown by providers. `retryable` drives retry/backoff; non-retryable errors fall through to the next provider. */
export class ProviderError extends Error {
  override name = 'ProviderError';
  retryable: boolean;
  retryAfterMs: number | undefined;
  status: number | undefined;
  constructor(message: string, opts: { retryable: boolean; retryAfterMs?: number; status?: number; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.retryable = opts.retryable;
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
  }
}
export class BudgetExceededError extends Error {
  override name = 'BudgetExceededError';
}
export class NoProviderError extends Error {
  override name = 'NoProviderError';
}
export interface Attempt { provider: string; attempt: number; error: string; retryable: boolean }
export class JobFailedError extends Error {
  override name = 'JobFailedError';
  attempts: Attempt[];
  constructor(message: string, attempts: Attempt[]) {
    super(message);
    this.attempts = attempts;
  }
}
