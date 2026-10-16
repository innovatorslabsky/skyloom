import { formatUsd } from './types.ts';
import type { Aspect, MicroUsd, VideoCall } from './types.ts';
import type { JobQueue, JobResult } from './queue.ts';
import type { Registry } from './registry.ts';

export interface BatchSpec {
  /** One idea per line from the user's list. */
  ideas: readonly string[];
  video: { durationSec: number; aspect: Aspect; resolution: VideoCall['resolution'] };
  /** Turn each short idea into a detailed scene prompt with a text provider first. */
  expandWithText?: boolean;
  system?: string;
}
export interface Estimate { perItem: MicroUsd; total: MicroUsd; text: string }

const videoCall = (spec: BatchSpec, prompt: string): VideoCall => ({ kind: 'video', prompt, ...spec.video });

/** Price the batch with the cheapest registered providers, before a single request is sent. */
export function estimateBatch(registry: Registry, spec: BatchSpec): Estimate {
  const probe = spec.ideas[0] ?? '';
  const v = registry.cheapest(videoCall(spec, probe)).cost;
  const t = spec.expandWithText ? registry.cheapest({ kind: 'text', prompt: probe }).cost : 0;
  const perItem = v + t;
  const total = perItem * spec.ideas.length;
  return { perItem, total, text: `${spec.ideas.length} video × ${formatUsd(perItem)} ≈ ${formatUsd(total)}` };
}

export type ItemResult =
  | { idea: string; ok: true; video: JobResult; prompt: string }
  | { idea: string; ok: false; error: string };

/** Runs every idea through (optional) text expansion then video. One item failing never stops the batch. */
export async function runBatch(queue: JobQueue, spec: BatchSpec, signal?: AbortSignal): Promise<{ items: ItemResult[]; spent: MicroUsd }> {
  let spent = 0;
  const items = await Promise.all(
    spec.ideas.map(async (idea, i): Promise<ItemResult> => {
      try {
        let prompt = idea;
        if (spec.expandWithText) {
          const t = await queue.run(`text-${i}`, { kind: 'text', prompt: idea, ...(spec.system ? { system: spec.system } : {}), maxTokens: 300 }, signal);
          spent += t.cost;
          prompt = t.output.text ?? idea;
        }
        const video = await queue.run(`video-${i}`, videoCall(spec, prompt), signal);
        spent += video.cost;
        return { idea, ok: true, video, prompt };
      } catch (e) {
        if (signal?.aborted) throw e;
        return { idea, ok: false, error: (e as Error).message };
      }
    }),
  );
  return { items, spent };
}
