import type { QueueEvent } from 'skyloom-core';
import type { ConfigStore, KeyStore } from './service.ts';
import { SkyloomService } from './service.ts';
import type { HistoryEntry, ProviderConfig, SkyloomApi } from './shared/api.ts';

/** In-browser stand-in used when there is no Electron bridge: memory-only, mock providers, no network. */
export function createDemoApi(): SkyloomApi {
  const listeners = new Set<(e: QueueEvent) => void>();
  let configs: ProviderConfig[] = [];
  const keys = new Map<string, string>();
  const history: HistoryEntry[] = [];
  const config: ConfigStore = { load: async () => configs, save: async (l) => { configs = l; } };
  const keyStore: KeyStore = { get: async (id) => keys.get(id), set: async (id, k) => { keys.set(id, k); }, delete: async (id) => { keys.delete(id); } };
  const svc = new SkyloomService({ keys: keyStore, config, demo: true, retryBaseMs: 300, onEvent: (e) => listeners.forEach((l) => l(e)) });
  return {
    info: async () => ({ mode: 'demo', secureKeys: false, note: 'Chế độ chạy thử trong trình duyệt: dùng nhà cung cấp giả, không gửi gì ra ngoài, không lưu khoá.' }),
    listProviders: () => svc.listProviders(),
    saveProvider: (p) => svc.saveProvider(p),
    removeProvider: (id) => svc.removeProvider(id),
    estimate: (r) => svc.estimate(r),
    run: async (r) => {
      const out = await svc.run(r);
      if (!('error' in out)) {
        const items = out.items.map((i) => ({ idea: i.idea, ok: i.ok, ...(i.provider ? { provider: i.provider } : {}), ...(i.costMicro !== undefined ? { costMicro: i.costMicro } : {}), ...(i.error ? { error: i.error } : {}) }));
        const now = new Date().toISOString();
        history.unshift({ id: now, createdAt: now, count: items.length, okCount: items.filter((i) => i.ok).length, spentMicro: out.spentMicro, cancelled: out.cancelled, items });
      }
      return out;
    },
    listHistory: async () => history,
    openHistory: async () => {},
    cancel: () => svc.cancel(),
    onEvent: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
