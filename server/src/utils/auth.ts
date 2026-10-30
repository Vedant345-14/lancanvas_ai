import crypto from 'crypto';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface TokenClaims { pid: string; sid: string; exp: number }

/** Compact HMAC-SHA256 signed token: base64url(payload).base64url(signature) */
export function signToken(secret: string, pid: string, sid: string, ttlSec = 60 * 60 * 24 * 3): string {
  const payload = b64(JSON.stringify({ pid, sid, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest();
  return `${payload}.${b64(sig)}`;
}

export function verifyToken(secret: string, token: unknown): TokenClaims | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
    if (typeof c.pid !== 'string' || typeof c.sid !== 'string' || c.exp < Date.now() / 1000) return null;
    return c;
  } catch { return null; }
}

/** scrypt password hashing with a per-password random salt. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function generateCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}
export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
