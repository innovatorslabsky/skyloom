import type { QueueEvent } from 'skyloom-core';
import type { ConfigStore, KeyStore } from './service.ts';
import { SkyloomService } from './service.ts';
import type { ProviderConfig, SkyloomApi } from './shared/api.ts';

/** In-browser stand-in used when there is no Electron bridge: memory-only, mock providers, no network. */
export function createDemoApi(): SkyloomApi {
  const listeners = new Set<(e: QueueEvent) => void>();
  let configs: ProviderConfig[] = [];
  const keys = new Map<string, string>();
  const config: ConfigStore = { load: async () => configs, save: async (l) => { configs = l; } };
  const keyStore: KeyStore = { get: async (id) => keys.get(id), set: async (id, k) => { keys.set(id, k); }, delete: async (id) => { keys.delete(id); } };
  const svc = new SkyloomService({ keys: keyStore, config, demo: true, retryBaseMs: 300, onEvent: (e) => listeners.forEach((l) => l(e)) });
  return {
    info: async () => ({ mode: 'demo', secureKeys: false, note: 'Chế độ chạy thử trong trình duyệt: dùng nhà cung cấp giả, không gửi gì ra ngoài, không lưu khoá.' }),
    listProviders: () => svc.listProviders(),
    saveProvider: (p) => svc.saveProvider(p),
    removeProvider: (id) => svc.removeProvider(id),
    estimate: (r) => svc.estimate(r),
    run: (r) => svc.run(r),
    cancel: () => svc.cancel(),
    onEvent: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
