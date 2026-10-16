import { contextBridge, ipcRenderer } from 'electron';
import type { QueueEvent } from 'skyloom-core';
import type { SkyloomApi } from '../src/shared/api.ts';

// Exposes a fixed set of calls. No generic ipcRenderer, no Node, and no way to read a key back.
const api: SkyloomApi = {
  info: () => ipcRenderer.invoke('info'),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  saveProvider: (p) => ipcRenderer.invoke('providers:save', p),
  removeProvider: (id) => ipcRenderer.invoke('providers:remove', id),
  estimate: (r) => ipcRenderer.invoke('batch:estimate', r),
  run: (r) => ipcRenderer.invoke('batch:run', r),
  cancel: () => ipcRenderer.invoke('batch:cancel'),
  onEvent: (cb) => {
    const h = (_: unknown, e: QueueEvent) => cb(e);
    ipcRenderer.on('batch:event', h);
    return () => ipcRenderer.removeListener('batch:event', h);
  },
};
contextBridge.exposeInMainWorld('skyloom', api);
