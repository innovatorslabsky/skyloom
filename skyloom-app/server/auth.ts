import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const b64u = (b: Buffer) => b.toString('base64url');

/** `scrypt$<salt>$<hash>` (base64url). Used so the password itself never has to sit in an environment variable. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${b64u(salt)}$${b64u(hash)}`;
}
async function checkHash(password: string, stored: string): Promise<boolean> {
  const [kind, s, h] = stored.split('$');
  if (kind !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64url');
  const got = await scrypt(password, Buffer.from(s, 'base64url'), want.length, SCRYPT);
  return want.length === got.length && timingSafeEqual(want, got);
}
/** Equal-length digests make the comparison constant-time regardless of the inputs' lengths. */
function safeEqual(a: string, b: string, key: Buffer): boolean {
  const da = createHmac('sha256', key).update(a).digest();
  const db = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(da, db);
}

export interface AuthConfig {
  user: string;
  /** Preferred: output of hashPassword(). */
  passwordHash?: string;
  /** Fallback for quick setups. */
  password?: string;
  /** At least 32 characters. Signs session cookies. */
  secret: string;
  sessionTtlMs?: number;
  now?: () => number;
}

export function createAuth(c: AuthConfig) {
  if (c.secret.length < 32) throw new Error('SKYLOOM_SECRET must be at least 32 characters.');
  if (!c.passwordHash && !c.password) throw new Error('Set SKYLOOM_PASSWORD_HASH (or SKYLOOM_PASSWORD).');
  const now = c.now ?? Date.now;
  const ttl = c.sessionTtlMs ?? 7 * 24 * 3600_000;
  const key = createHmac('sha256', c.secret).update('skyloom-session-v1').digest();
  const sign = (exp: string) => createHmac('sha256', key).update(exp).digest('base64url');
  return {
    async checkLogin(user: string, password: string): Promise<boolean> {
      // Both checks always run, so timing does not reveal whether the user name was right.
      const userOk = safeEqual(user, c.user, key);
      const passOk = c.passwordHash ? await checkHash(password, c.passwordHash) : safeEqual(password, c.password!, key);
      return userOk && passOk;
    },
    newSession(): { token: string; maxAgeSec: number } {
      const exp = String(now() + ttl);
      return { token: `${exp}.${sign(exp)}`, maxAgeSec: Math.floor(ttl / 1000) };
    },
    checkSession(token: string | undefined): boolean {
      if (!token) return false;
      const [exp, mac] = token.split('.');
      if (!exp || !mac || !/^\d{10,16}$/.test(exp)) return false;
      const want = Buffer.from(sign(exp)), got = Buffer.from(mac);
      return want.length === got.length && timingSafeEqual(want, got) && Number(exp) > now();
    },
  };
}

/** Counts failed logins per client; after `max` failures within `windowMs` further attempts are refused until the window ends. */
export function createLimiter(max = 8, windowMs = 15 * 60_000, now: () => number = Date.now) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    blocked(id: string): boolean {
      const h = hits.get(id);
      if (!h) return false;
      if (h.reset <= now()) { hits.delete(id); return false; }
      return h.n >= max;
    },
    fail(id: string): void {
      const h = hits.get(id);
      if (!h || h.reset <= now()) hits.set(id, { n: 1, reset: now() + windowMs });
      else h.n++;
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now()) hits.delete(k);
    },
    ok(id: string): void { hits.delete(id); },
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
