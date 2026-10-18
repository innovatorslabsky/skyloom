import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Cipher } from '../electron/stores.ts';

/**
 * AES-256-GCM cipher for the key store, keyed from SKYLOOM_SECRET (HKDF, separate from the session-signing key).
 * Layout: 12-byte IV | 16-byte tag | ciphertext. Tampering or a changed secret makes decrypt throw, which the store treats as "no key".
 */
export function aesCipher(secret: string): Cipher {
  if (secret.length < 32) throw new Error('SKYLOOM_SECRET must be at least 32 characters.');
  const key = Buffer.from(hkdfSync('sha256', secret, 'skyloom-keystore-salt', 'skyloom-keystore-v1', 32));
  return {
    available: () => true,
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]);
    },
    decrypt(data) {
      if (data.length < 29) throw new Error('bad blob');
      const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      d.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
