import { Budget, JobQueue, NoProviderError, Registry, estimateBatch, mockProvider, FAL_PRESETS, falPreset, falVideo, geminiOmniVideo, openAiCompatText, runBatch, usd } from 'skyloom-core';
import type { BatchSpec, QueueEvent } from 'skyloom-core';
import type { BatchOutcome, BatchRequest, EstimateResult, ItemOutcome, ProviderConfig, ProviderInput } from './shared/api.ts';

export interface KeyStore {
  get(id: string): Promise<string | undefined>;
  set(id: string, key: string): Promise<void>;
  delete(id: string): Promise<void>;
}
export interface ConfigStore {
  load(): Promise<ProviderConfig[]>;
  save(list: ProviderConfig[]): Promise<void>;
}
export interface ServiceOptions {
  keys: KeyStore;
  config: ConfigStore;
  /** Demo mode adds free offline mock providers so the whole flow can be tried without any key. */
  demo?: boolean;
  fetch?: typeof fetch;
  /** Mock latency in demo mode, ms. */
  demoDelayMs?: number;
  retryBaseMs?: number;
  /** Poll interval for async video jobs, ms. */
  pollIntervalMs?: number;
  onEvent?: (e: QueueEvent) => void;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FAL_DEFAULT_URL = 'https://queue.fal.run';
export const OMNI_DEFAULT_URL = 'https://generativelanguage.googleapis.com';
export const OMNI_DEFAULT_MODEL = 'gemini-omni-1.1-flash';

/** Keys are only sent over https, except to a loopback address (local gateways, tests). */
export function validateProvider(p: ProviderInput): string | undefined {
  if (!ID.test(p.id)) return 'Mã nhà cung cấp chỉ gồm chữ thường, số và dấu gạch ngang (tối đa 40 ký tự).';
  if (!p.label.trim()) return 'Cần đặt tên hiển thị.';
  if (!p.model.trim() && p.kind !== 'gemini-omni-video') return 'Cần nhập tên model.';
  if (!p.apiKey.trim()) return 'Cần nhập khoá API.';
  if (p.kind !== 'openai-compat-text' && p.kind !== 'fal-video' && p.kind !== 'gemini-omni-video') return 'Loại nhà cung cấp không hợp lệ.';
  const fal = p.kind === 'fal-video';
  const omni = p.kind === 'gemini-omni-video';
  let u: URL;
  try { u = new URL((fal || omni) && !p.baseUrl.trim() ? (fal ? FAL_DEFAULT_URL : OMNI_DEFAULT_URL) : p.baseUrl); } catch { return 'Địa chỉ API không hợp lệ.'; }
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return 'Địa chỉ API phải dùng https (chỉ http khi là localhost).';
  if (u.username || u.password) return 'Không đặt tài khoản/mật khẩu trong địa chỉ API.';
  for (const [k, v] of [['rpm', p.rpm], ['giá vào', p.usdPerMillionIn], ['giá ra', p.usdPerMillionOut], ['giá mỗi giây', p.usdPerSecond], ['số giây tính tiền', p.fixedSeconds]] as const) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) return `Giá trị "${k}" không hợp lệ.`;
  }
  if (omni && p.fixedSeconds !== undefined && p.fixedSeconds <= 0) return 'Số giây tính tiền phải lớn hơn 0.';
  if (fal || omni) {
    // A video call that looks free would defeat the budget cap, so the price must be stated explicitly.
    if (p.usdPerSecond === undefined) return 'Cần nhập giá mỗi giây của model (xem trang giá của nhà cung cấp).';
    if (fal && p.preset && !falPreset(p.preset)) return 'Mẫu model không hợp lệ.';
    if (p.extraInput !== undefined && (typeof p.extraInput !== 'object' || p.extraInput === null || Array.isArray(p.extraInput) || JSON.stringify(p.extraInput).length > 4000)) return 'Tham số bổ sung phải là một đối tượng JSON nhỏ.';
  }
  return undefined;
}

export function validateBatch(r: BatchRequest): string | undefined {
  if (!Array.isArray(r.ideas) || r.ideas.length === 0) return 'Hãy nhập ít nhất một ý tưởng.';
  if (r.ideas.length > 500) return 'Tối đa 500 ý tưởng mỗi lô.';
  if (r.ideas.some((i) => typeof i !== 'string' || i.length === 0 || i.length > 2000)) return 'Mỗi ý tưởng cần có chữ và không quá 2000 ký tự.';
  if (!Number.isFinite(r.durationSec) || r.durationSec < 1 || r.durationSec > 120) return 'Độ dài clip phải từ 1 đến 120 giây.';
  if (!Number.isFinite(r.budgetUsd) || r.budgetUsd < 0 || r.budgetUsd > 100_000) return 'Ngân sách không hợp lệ.';
  return undefined;
}

export class SkyloomService {
  #o: ServiceOptions;
  #abort: AbortController | undefined;
  constructor(o: ServiceOptions) {
    this.#o = o;
  }

  listProviders(): Promise<ProviderConfig[]> {
    return this.#o.config.load();
  }
  async saveProvider(p: ProviderInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const error = validateProvider(p);
    if (error) return { ok: false, error };
    const { apiKey, ...rest } = p;
    const cfg: ProviderConfig = p.kind === 'fal-video' ? { ...rest, baseUrl: rest.baseUrl.trim() || FAL_DEFAULT_URL }
      : p.kind === 'gemini-omni-video' ? { ...rest, baseUrl: rest.baseUrl.trim() || OMNI_DEFAULT_URL, model: rest.model.trim() || OMNI_DEFAULT_MODEL }
      : rest;
    const list = (await this.#o.config.load()).filter((x) => x.id !== cfg.id);
    try {
      // Key first: if it cannot be stored safely, no provider entry is created.
      await this.#o.keys.set(cfg.id, apiKey);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    await this.#o.config.save([...list, cfg]);
    return { ok: true };
  }
  async removeProvider(id: string): Promise<void> {
    await this.#o.keys.delete(id);
    await this.#o.config.save((await this.#o.config.load()).filter((x) => x.id !== id));
  }

  async #registry(): Promise<Registry> {
    const registry = new Registry();
    for (const c of await this.#o.config.load()) {
      const apiKey = await this.#o.keys.get(c.id);
      if (!apiKey) continue; // a provider without a key is simply unavailable
      const f = this.#o.fetch ? { fetch: this.#o.fetch } : {};
      if (c.kind === 'gemini-omni-video') {
        registry.register(geminiOmniVideo({
          id: c.id, label: c.label, apiKey, model: c.model || OMNI_DEFAULT_MODEL, usdPerSecond: c.usdPerSecond ?? 0, baseUrl: c.baseUrl || OMNI_DEFAULT_URL,
          ...(c.fixedSeconds !== undefined ? { fixedSeconds: c.fixedSeconds } : {}), ...(c.extraInput ? { extraBody: c.extraInput } : {}), ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
          ...(this.#o.pollIntervalMs !== undefined ? { pollIntervalMs: this.#o.pollIntervalMs } : {}), ...f,
        }));
      } else if (c.kind === 'fal-video') {
        registry.register(falVideo({
          id: c.id, label: c.label, apiKey, model: c.model, usdPerSecond: c.usdPerSecond ?? 0, baseUrl: c.baseUrl || FAL_DEFAULT_URL,
          ...(c.extraInput ? { extraInput: c.extraInput } : {}), ...(c.preset ? { preset: c.preset } : {}), ...(c.rpm !== undefined ? { rpm: c.rpm } : {}),
          ...(this.#o.pollIntervalMs !== undefined ? { pollIntervalMs: this.#o.pollIntervalMs } : {}), ...f,
        }));
      } else {
        registry.register(openAiCompatText({ ...c, apiKey, ...f }));
      }
    }
    if (this.#o.demo) {
      const delay = () => new Promise<void>((r) => setTimeout(r, this.#o.demoDelayMs ?? 400));
      if (!registry.list().some((p) => p.kinds.includes('text'))) registry.register(mockProvider({ id: 'demo-text', kinds: ['text'], delay, maxConcurrent: 4 }));
      if (!registry.list().some((p) => p.kinds.includes('video'))) registry.register(mockProvider({ id: 'demo-video', kinds: ['video', 'image'], costPerCall: usd(0.05), failFirst: 1, delay, maxConcurrent: 3 }));
    }
    return registry;
  }
  #spec(r: BatchRequest): BatchSpec {
    return { ideas: r.ideas, video: { durationSec: r.durationSec, aspect: r.aspect, resolution: r.resolution }, expandWithText: r.expandWithText };
  }

  /** Video providers whose preset cannot do this clip length would fail every item; say so up front instead. */
  async #durationProblem(r: BatchRequest): Promise<string | undefined> {
    const all = (await this.#o.config.load()).filter((c) => c.kind !== 'openai-compat-text');
    // Google documents only 9:16 and 16:9 for Omni, so a 1:1 batch could never succeed with Omni alone.
    if (all.length > 0 && all.every((c) => c.kind === 'gemini-omni-video') && r.aspect === '1:1') return 'Gemini Omni chỉ hỗ trợ tỉ lệ 9:16 và 16:9.';
    const video = all.filter((c) => c.kind === 'fal-video');
    if (video.length === 0) return undefined;
    const ok = video.some((c) => {
      const pr = c.preset ? falPreset(c.preset) : undefined;
      return !pr || (Number.isInteger(r.durationSec) && r.durationSec >= pr.seconds[0] && r.durationSec <= pr.seconds[1]);
    });
    if (ok) return undefined;
    const ranges = video.map((c) => falPreset(c.preset ?? '')).filter((x) => x !== undefined).map((x) => `${x.label}: ${x.seconds[0]}–${x.seconds[1]} giây`).join('; ');
    return `Độ dài ${r.durationSec} giây không được nhà cung cấp video đã thêm hỗ trợ (${ranges}).`;
  }

  async estimate(r: BatchRequest): Promise<EstimateResult> {
    const bad = validateBatch(r) ?? (await this.#durationProblem(r));
    if (bad) return { ok: false, error: bad };
    try {
      const e = estimateBatch(await this.#registry(), this.#spec(r));
      return { ok: true, ...e };
    } catch (err) {
      if (err instanceof NoProviderError) return { ok: false, error: 'Chưa có nhà cung cấp cho loại việc này. Hãy thêm ở tab "Nhà cung cấp" (video cần một nhà cung cấp video).' };
      throw err;
    }
  }

  /** `saveBytes` stores a video the provider returned inline (not as a URL) and gives back its path relative to the batch folder. */
  async run(r: BatchRequest, saveBytes?: (index: number, bytes: Uint8Array, mime: string) => Promise<string>): Promise<BatchOutcome | { error: string }> {
    const bad = validateBatch(r);
    const bad2 = bad ?? (await this.#durationProblem(r));
    if (bad2) return { error: bad2 };
    if (this.#abort) return { error: 'Đang có một lô chạy. Hãy chờ hoặc huỷ trước.' };
    const registry = await this.#registry();
    const budget = new Budget(usd(r.budgetUsd));
    const queue = new JobQueue({ registry, budget, strategy: r.strategy, concurrency: 3, retry: { baseMs: this.#o.retryBaseMs ?? 1000 } });
    if (this.#o.onEvent) queue.on(this.#o.onEvent);
    const ac = (this.#abort = new AbortController());
    try {
      const { items } = await runBatch(queue, { ...this.#spec(r), system: 'Viết một mô tả cảnh quay ngắn, cụ thể, bằng một đoạn văn.' }, ac.signal);
      return {
        spentMicro: budget.spent,
        cancelled: false,
        items: await Promise.all(items.map(async (i, n): Promise<ItemOutcome> => {
          if (!i.ok) return { idea: i.idea, ok: false, error: i.error };
          const media = i.video.output.media;
          const base: ItemOutcome = { idea: i.idea, ok: true, provider: i.video.provider, costMicro: i.video.cost, prompt: i.prompt, ...(media?.url ? { mediaUrl: media.url } : {}) };
          if (media?.bytes && !media.url) {
            if (!saveBytes) return { ...base, downloadError: 'Nhà cung cấp trả video trực tiếp nhưng không có nơi lưu (chế độ này không lưu file).' };
            try { return { ...base, file: await saveBytes(n, media.bytes, media.mime) }; } catch (e) { return { ...base, downloadError: (e as Error).message }; }
          }
          return base;
        })),
      };
    } catch (err) {
      if (ac.signal.aborted) return { items: [], spentMicro: budget.spent, cancelled: true };
      return { error: (err as Error).message };
    } finally {
      this.#abort = undefined;
    }
  }
  async cancel(): Promise<void> {
    this.#abort?.abort(new Error('cancelled'));
  }
}
