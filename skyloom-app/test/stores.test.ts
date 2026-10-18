import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encryptedKeyStore, jsonConfigStore } from '../electron/stores.ts';
import type { Cipher } from '../electron/stores.ts';

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
const fake = (available = true): Cipher => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
});

describe('encryptedKeyStore', () => {
  it('stores keys encrypted, not as plaintext, with owner-only permissions', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sky-'));
    const s = encryptedKeyStore(dir, fake());
    await s.set('nim', 'sk-very-secret');
    const raw = await readFile(join(dir, 'keys.json'), 'utf8');
    expect(raw).not.toContain('sk-very-secret');
    expect(await s.get('nim')).toBe('sk-very-secret');
    if (process.platform !== 'win32') expect((await stat(join(dir, 'keys.json'))).mode & 0o777).toBe(0o600);
  });
  it('refuses to store a key when real encryption is unavailable', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sky-'));
    await expect(encryptedKeyStore(dir, fake(false)).set('nim', 'k')).rejects.toThrow();
  });
  it('does not return a key when encryption becomes unavailable, and delete removes it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sky-'));
    await encryptedKeyStore(dir, fake()).set('nim', 'k');
    expect(await encryptedKeyStore(dir, fake(false)).get('nim')).toBeUndefined();
    const s = encryptedKeyStore(dir, fake());
    await s.delete('nim');
    expect(await s.get('nim')).toBeUndefined();
  });
});

describe('jsonConfigStore', () => {
  it('round-trips and tolerates a missing or corrupt file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sky-'));
    const s = jsonConfigStore(dir);
    expect(await s.load()).toEqual([]);
    await s.save([{ id: 'a', label: 'A', kind: 'openai-compat-text', baseUrl: 'https://x/v1', model: 'm' }]);
    expect((await s.load())[0]?.id).toBe('a');
    await import('node:fs/promises').then((fs) => fs.writeFile(join(dir, 'providers.json'), '{not json'));
    expect(await s.load()).toEqual([]);
  });
});
