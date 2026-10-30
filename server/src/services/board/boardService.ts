import type { DB } from '../../database/db';
import type { BoardObject } from '../../types';
import { badRequest, forbidden, HttpError } from '../../utils/errors';
import { MAX_OBJECTS_PER_SESSION, objectSchema, patchSchema } from './boardSchema';

type Row = { id: string; z: number; data: string };

/** Write-through board store: authoritative state lives in SQLite with a per-session in-memory cache. */
export class BoardService {
  private cache = new Map<string, Map<string, BoardObject>>();
  private zCounter = new Map<string, number>();
  constructor(private db: DB) {}

  private load(sessionId: string): Map<string, BoardObject> {
    let m = this.cache.get(sessionId);
    if (m) return m;
    m = new Map();
    const rows = this.db.prepare('SELECT id, z, data FROM board_objects WHERE session_id = ? ORDER BY z').all(sessionId) as Row[];
    let maxZ = 0;
    for (const r of rows) { const o = JSON.parse(r.data) as BoardObject; m.set(o.id, o); maxZ = Math.max(maxZ, o.z); }
    this.cache.set(sessionId, m);
    this.zCounter.set(sessionId, maxZ);
    return m;
  }

  list(sessionId: string): BoardObject[] {
    return [...this.load(sessionId).values()].sort((a, b) => a.z - b.z);
  }

  private save(sessionId: string, o: BoardObject) {
    this.db.prepare('INSERT INTO board_objects (session_id, id, z, data) VALUES (?,?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET z=excluded.z, data=excluded.data')
      .run(sessionId, o.id, o.z, JSON.stringify(o));
  }

  add(sessionId: string, raw: unknown, author: string, imageExists: (src: string) => boolean): BoardObject {
    const parsed = objectSchema.safeParse(raw);
    if (!parsed.success) throw badRequest('Invalid board object.');
    const m = this.load(sessionId);
    if (m.has(parsed.data.id)) throw new HttpError(409, 'DUPLICATE', 'Object already exists.');
    if (m.size >= MAX_OBJECTS_PER_SESSION) throw badRequest('The board has too many objects.');
    if (parsed.data.type === 'image' && !imageExists(parsed.data.src!)) throw forbidden('Unknown image for this classroom.');
    const z = (this.zCounter.get(sessionId) ?? 0) + 1;
    this.zCounter.set(sessionId, z);
    const obj = { ...parsed.data, author, z, ts: Date.now() } as BoardObject;
    m.set(obj.id, obj);
    this.save(sessionId, obj);
    return obj;
  }

  update(sessionId: string, id: string, rawPatch: unknown): BoardObject {
    const m = this.load(sessionId);
    const existing = m.get(id); // lookup is scoped to this session => no cross-session edits
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Object not found.');
    const patch = patchSchema.safeParse(rawPatch);
    if (!patch.success) throw badRequest('Invalid update.');
    const { author, z, ts, ...base } = existing;
    const merged = objectSchema.safeParse({ ...base, ...patch.data });
    if (!merged.success) throw badRequest('Invalid update.');
    const next = { ...merged.data, author, z, ts: Date.now() } as BoardObject;
    m.set(id, next);
    this.save(sessionId, next);
    return next;
  }

  remove(sessionId: string, ids: string[]): string[] {
    const m = this.load(sessionId);
    const removed: string[] = [];
    const del = this.db.prepare('DELETE FROM board_objects WHERE session_id = ? AND id = ?');
    this.db.transaction(() => { for (const id of ids) if (m.delete(id)) { del.run(sessionId, id); removed.push(id); } })();
    return removed;
  }

  clear(sessionId: string): number {
    const m = this.load(sessionId);
    const n = m.size;
    m.clear();
    this.db.prepare('DELETE FROM board_objects WHERE session_id = ?').run(sessionId);
    return n;
  }
}
