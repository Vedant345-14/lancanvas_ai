import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  uploadDir: string;
  sessionSecret: string;
  ai: { apiKey: string; baseUrl: string; model: string; vision: boolean };
  clientDist: string;
  maxUploadBytes: number;
  /** Max join/create attempts per IP per minute (brute-force protection). */
  joinRateLimit: number;
}

const resolveFromRoot = (p: string) => (p === ':memory:' || path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p));

function loadSecret(dataDir: string, fromEnv: string | undefined): string {
  if (fromEnv && fromEnv.length >= 24 && !fromEnv.startsWith('replace_with')) return fromEnv;
  const file = path.join(dataDir, '.session_secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* create below */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const e = process.env;
  const databasePath = resolveFromRoot(e.DATABASE_PATH || './data/lancanvas.db');
  const dataDir = databasePath === ':memory:' ? path.join(ROOT_DIR, 'data') : path.dirname(databasePath);
  const base: Config = {
    port: Number(e.PORT) || 8000,
    host: e.HOST || '0.0.0.0',
    databasePath,
    uploadDir: resolveFromRoot(e.UPLOAD_DIR || './uploads'),
    sessionSecret: overrides.sessionSecret ?? loadSecret(dataDir, e.SESSION_SECRET),
    ai: {
      apiKey: e.AI_API_KEY || '',
      baseUrl: (e.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: e.AI_MODEL || 'gpt-4o-mini',
      vision: (e.AI_VISION || 'true').toLowerCase() !== 'false',
    },
    clientDist: path.join(ROOT_DIR, 'client', 'dist'),
    maxUploadBytes: 5 * 1024 * 1024,
    joinRateLimit: 20,
  };
  return { ...base, ...overrides };
}
