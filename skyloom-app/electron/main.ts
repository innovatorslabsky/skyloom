import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { SkyloomService } from '../src/service.ts';
import type { AppInfo, BatchOutcome, BatchRequest, ProviderInput } from '../src/shared/api.ts';
import { downloadBatch, saveVideoBytes } from './download.ts';
import { listHistory, runDir } from './history.ts';
import { encryptedKeyStore, jsonConfigStore } from './stores.ts';
import type { Cipher } from './stores.ts';

const cipher: Cipher = {
  // On Linux without a keyring Electron falls back to "basic_text" (a hard-coded key): treat that as unavailable.
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

let win: BrowserWindow | undefined;
let service: SkyloomService;

async function writeManifest(req: BatchRequest, out: BatchOutcome, dir: string): Promise<void> {
  await writeFile(join(dir, 'batch.json'), JSON.stringify({ request: req, outcome: out }, null, 2));
}

function wire(): void {
  ipcMain.handle('info', (): AppInfo => ({ mode: 'desktop', secureKeys: cipher.available() }));
  ipcMain.handle('providers:list', () => service.listProviders());
  ipcMain.handle('providers:save', (_e, p: ProviderInput) => service.saveProvider(p));
  ipcMain.handle('providers:remove', (_e, id: string) => service.removeProvider(String(id)));
  ipcMain.handle('batch:estimate', (_e, r: BatchRequest) => service.estimate(r));
  ipcMain.handle('batch:run', async (_e, r: BatchRequest) => {
    const dir = join(app.getPath('documents'), 'Skyloom', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(dir, { recursive: true });
    const out = await service.run(r, (i, bytes, mime) => saveVideoBytes(dir, i, bytes, mime));
    if ('error' in out) return out;
    const saved = await downloadBatch(out, dir);
    await writeManifest(r, saved, dir);
    return { ...saved, outputDir: dir };
  });
  ipcMain.handle('batch:cancel', () => service.cancel());
  const base = () => join(app.getPath('documents'), 'Skyloom');
  ipcMain.handle('history:list', () => listHistory(base()));
  ipcMain.handle('history:open', async (_e, id: unknown) => {
    const dir = runDir(base(), id);
    if (dir) await shell.openPath(dir);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 600, backgroundColor: '#060914', title: 'Skyloom',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The renderer is a local page only: no popups, no navigation away, links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const dev = process.env.VITE_DEV_SERVER_URL;
  void (dev ? win.loadURL(dev) : win.loadFile(join(__dirname, '../renderer/index.html')));
}

void app.whenReady().then(() => {
  const dir = app.getPath('userData');
  service = new SkyloomService({
    keys: encryptedKeyStore(dir, cipher),
    config: jsonConfigStore(dir),
    onEvent: (e) => win?.webContents.send('batch:event', e),
  });
  wire();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
