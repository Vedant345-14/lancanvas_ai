import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { DB } from '../database/db';
import { newId } from '../utils/auth';
import { badRequest } from '../utils/errors';

const SIGS: { ext: 'png' | 'jpg' | 'webp'; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Sniffs the real file type from magic bytes. Never trusts the client-supplied mimetype/extension. */
export function sniffImage(buf: Buffer) {
  return SIGS.find((s) => s.test(buf)) ?? null;
}

export class UploadService {
  constructor(private db: DB, private dir: string, private maxBytes: number) {}

  save(sessionId: string, uploaderId: string, originalName: string, buf: Buffer) {
    if (buf.length === 0) throw badRequest('Empty file.');
    if (buf.length > this.maxBytes) throw badRequest(`Image is too large (max ${Math.round(this.maxBytes / 1048576)} MB).`);
    const sig = sniffImage(buf);
    if (!sig) throw badRequest('Only PNG, JPEG and WebP images are allowed.');
    const filename = `${crypto.randomBytes(12).toString('hex')}.${sig.ext}`;
    const sessionDir = this.sessionDir(sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, filename), buf, { mode: 0o640 });
    this.db.prepare('INSERT INTO uploads (id, session_id, filename, original_name, mime, size, uploader_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(newId(), sessionId, filename, originalName.slice(0, 120), sig.mime, buf.length, uploaderId, Date.now());
    return { src: filename, mime: sig.mime, size: buf.length };
  }

  exists(sessionId: string, filename: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM uploads WHERE session_id = ? AND filename = ?').get(sessionId, filename);
  }

  /** Returns an absolute path only if the file is registered to this session; blocks traversal. */
  resolve(sessionId: string, filename: string): { file: string; mime: string } | null {
    if (!/^[a-f0-9]{24}\.(png|jpg|webp)$/.test(filename)) return null;
    const row = this.db.prepare('SELECT mime FROM uploads WHERE session_id = ? AND filename = ?').get(sessionId, filename) as { mime: string } | undefined;
    if (!row) return null;
    const file = path.join(this.sessionDir(sessionId), filename);
    return fs.existsSync(file) ? { file, mime: row.mime } : null;
  }

  private sessionDir(sessionId: string) {
    return path.join(this.dir, sessionId.replace(/[^A-Za-z0-9_-]/g, '_'));
  }
}
