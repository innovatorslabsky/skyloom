import type { QueueEvent } from 'skyloom-core';
import type { AppInfo, BatchOutcome, EstimateResult, HistoryEntry, ProviderConfig, SkyloomApi } from './shared/api.ts';

/** The page talks to the Skyloom web server instead of Electron. The session cookie is HttpOnly, so this code never sees it. */
export function createWebApi(): SkyloomApi {
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'skyloom' }, body: JSON.stringify(body) });
    if (res.status === 401) { location.replace('/login'); return new Promise<T>(() => {}); }
    return (await res.json()) as T;
  };
  const get = <T>(path: string): Promise<T> => fetch(path, { credentials: 'same-origin' }).then(async (res) => {
    if (res.status === 401) { location.replace('/login'); return new Promise<T>(() => {}); }
    return (await res.json()) as T;
  });
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  return {
    info: () => get<AppInfo>('/api/info'),
    listProviders: () => get<ProviderConfig[]>('/api/providers'),
    saveProvider: (p) => post('/api/providers/save', p),
    removeProvider: async (id) => { await post('/api/providers/remove', { id }); },
    estimate: (r) => post<EstimateResult>('/api/estimate', r),
    async run(r) {
      const started = await fetch('/api/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'skyloom' }, body: JSON.stringify(r) });
      if (started.status === 401) { location.replace('/login'); return new Promise<never>(() => {}); }
      if (!started.ok) return { error: ((await started.json()) as { error?: string }).error ?? 'Không bắt đầu được lô.' };
      // The batch runs on the server and can outlast one request, so wait by polling.
      for (;;) {
        await sleep(1500);
        const cur = await get<{ state: string; outcome?: BatchOutcome; error?: string }>('/api/run/current');
        if (cur.state === 'done' && cur.outcome) return cur.outcome;
        if (cur.state === 'error') return { error: cur.error ?? 'Lô chạy lỗi.' };
        if (cur.state === 'idle') return { error: 'Lô chạy không còn trên máy chủ (máy chủ có thể đã khởi động lại).' };
      }
    },
    cancel: async () => { await post('/api/cancel', {}); },
    listHistory: () => get<HistoryEntry[]>('/api/history'),
    openHistory: async () => {},
    logout: async () => { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'skyloom' } }); location.replace('/login'); },
    mediaUrl: (runId, file) => `/media/${encodeURIComponent(runId)}/${file.split('/').map(encodeURIComponent).join('/')}`,
    onEvent(cb) {
      const es = new EventSource('/api/events');
      es.onmessage = (m) => { try { cb(JSON.parse(m.data) as QueueEvent); } catch { /* ignore malformed */ } };
      return () => es.close();
    },
  };
}
