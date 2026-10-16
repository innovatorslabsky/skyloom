import { Budget, JobQueue, NoProviderError, Registry, estimateBatch, mockProvider, openAiCompatText, runBatch, usd } from 'skyloom-core';
import type { BatchSpec, QueueEvent } from 'skyloom-core';
import type { BatchOutcome, BatchRequest, EstimateResult, ProviderConfig, ProviderInput } from './shared/api.ts';

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
  onEvent?: (e: QueueEvent) => void;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Keys are only sent over https, except to a loopback address (local gateways, tests). */
export function validateProvider(p: ProviderInput): string | undefined {
  if (!ID.test(p.id)) return 'Mã nhà cung cấp chỉ gồm chữ thường, số và dấu gạch ngang (tối đa 40 ký tự).';
  if (!p.label.trim()) return 'Cần đặt tên hiển thị.';
  if (!p.model.trim()) return 'Cần nhập tên model.';
  if (!p.apiKey.trim()) return 'Cần nhập khoá API.';
  let u: URL;
  try { u = new URL(p.baseUrl); } catch { return 'Địa chỉ API không hợp lệ.'; }
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return 'Địa chỉ API phải dùng https (chỉ http khi là localhost).';
  if (u.username || u.password) return 'Không đặt tài khoản/mật khẩu trong địa chỉ API.';
  for (const [k, v] of [['rpm', p.rpm], ['giá vào', p.usdPerMillionIn], ['giá ra', p.usdPerMillionOut]] as const) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) return `Giá trị "${k}" không hợp lệ.`;
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
    const { apiKey, ...cfg } = p;
    const list = (await this.#o.config.load()).filter((x) => x.id !== cfg.id);
    try {
      // Key first: if it cannot be stored safely, no provider entry is created.
      await this.#o.keys.set(cfg.id, apiKey);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    await this.#o.config.save([...list, { ...cfg, kind: 'openai-compat-text' }]);
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
      registry.register(openAiCompatText({ ...c, apiKey, ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}) }));
    }
    if (this.#o.demo) {
      const delay = () => new Promise<void>((r) => setTimeout(r, this.#o.demoDelayMs ?? 400));
      if (!registry.list().some((p) => p.kinds.includes('text'))) registry.register(mockProvider({ id: 'demo-text', kinds: ['text'], delay, maxConcurrent: 4 }));
      registry.register(mockProvider({ id: 'demo-video', kinds: ['video', 'image'], costPerCall: usd(0.05), failFirst: 1, delay, maxConcurrent: 3 }));
    }
    return registry;
  }
  #spec(r: BatchRequest): BatchSpec {
    return { ideas: r.ideas, video: { durationSec: r.durationSec, aspect: r.aspect, resolution: r.resolution }, expandWithText: r.expandWithText };
  }

  async estimate(r: BatchRequest): Promise<EstimateResult> {
    const bad = validateBatch(r);
    if (bad) return { ok: false, error: bad };
    try {
      const e = estimateBatch(await this.#registry(), this.#spec(r));
      return { ok: true, ...e };
    } catch (err) {
      if (err instanceof NoProviderError) return { ok: false, error: 'Chưa có nhà cung cấp cho loại việc này. Hãy thêm ở tab "Nhà cung cấp" (video cần một nhà cung cấp video).' };
      throw err;
    }
  }

  async run(r: BatchRequest): Promise<BatchOutcome | { error: string }> {
    const bad = validateBatch(r);
    if (bad) return { error: bad };
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
        items: items.map((i) =>
          i.ok
            ? { idea: i.idea, ok: true, provider: i.video.provider, costMicro: i.video.cost, prompt: i.prompt, ...(i.video.output.media?.url ? { mediaUrl: i.video.output.media.url } : {}) }
            : { idea: i.idea, ok: false, error: i.error }),
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
