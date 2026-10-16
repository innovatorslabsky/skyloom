import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConfigStore, KeyStore } from '../src/service.ts';
import type { ProviderConfig } from '../src/shared/api.ts';

/** Minimal slice of Electron's safeStorage so the stores can be tested without Electron. */
export interface Cipher {
  /** False when the OS gives no real protection (e.g. Linux without a keyring uses a fixed key). */
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return fallback; }
}
/** Write-then-rename so a crash never leaves a half-written file. */
async function writeJson(file: string, data: unknown, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { ...(mode ? { mode } : {}) });
  await rename(tmp, file);
}

export const jsonConfigStore = (dir: string): ConfigStore => {
  const file = join(dir, 'providers.json');
  return { load: () => readJson<ProviderConfig[]>(file, []), save: (l) => writeJson(file, l) };
};

/**
 * API keys are encrypted with the OS keychain-backed cipher and stored base64 in keys.json (0600).
 * If real encryption is unavailable we refuse to store a key rather than fall back to plaintext.
 */
export const encryptedKeyStore = (dir: string, cipher: Cipher): KeyStore => {
  const file = join(dir, 'keys.json');
  const load = () => readJson<Record<string, string>>(file, {});
  return {
    async get(id) {
      const blob = (await load())[id];
      if (!blob || !cipher.available()) return undefined;
      try { return cipher.decrypt(Buffer.from(blob, 'base64')); } catch { return undefined; }
    },
    async set(id, key) {
      if (!cipher.available()) throw new Error('Hệ điều hành chưa có kho khoá an toàn nên Skyloom không lưu khoá API. Hãy cài/bật keyring (ví dụ gnome-keyring hoặc kwallet).');
      const all = await load();
      all[id] = cipher.encrypt(key).toString('base64');
      await writeJson(file, all, 0o600);
    },
    async delete(id) {
      const all = await load();
      delete all[id];
      await writeJson(file, all, 0o600);
    },
  };
};
