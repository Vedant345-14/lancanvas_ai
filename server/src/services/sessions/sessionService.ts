import { z } from 'zod';
import type { DB } from '../../database/db';
import type { Participant, Perms, Role, Session, Settings, Status } from '../../types';
import { generateCode, hashPassword, newId, verifyPassword } from '../../utils/auth';
import { badRequest, forbidden, notFound, HttpError } from '../../utils/errors';

export const DEFAULT_SETTINGS: Settings = {
  drawPolicy: 'selected',
  locked: false,
  requireApproval: true,
  allowUploads: true,
  allowAI: false,
  chatToAI: false,
  chatEnabled: true,
};
export const DEFAULT_PERMS: Perms = { canDraw: false, canUpload: true, canChat: true, canAI: true, canRequest: true };

export const displayName = z.string().trim().min(1, 'Enter a display name.').max(32, 'Display name is too long (max 32).');
export const createSessionSchema = z.object({
  name: z.string().trim().min(1, 'Enter a classroom name.').max(80),
  hostName: displayName,
  password: z.string().max(100).optional(),
  requireApproval: z.boolean().optional(),
}).strict();
export const joinSchema = z.object({ name: displayName, password: z.string().max(100).optional() }).strict();

export const settingsPatchSchema = z.object({
  drawPolicy: z.enum(['none', 'everyone', 'selected']),
  locked: z.boolean(),
  requireApproval: z.boolean(),
  allowUploads: z.boolean(),
  allowAI: z.boolean(),
  chatToAI: z.boolean(),
  chatEnabled: z.boolean(),
}).partial().strict();
export const permsPatchSchema = z.object({
  canDraw: z.boolean(), canUpload: z.boolean(), canChat: z.boolean(), canAI: z.boolean(), canRequest: z.boolean(),
}).partial().strict();

type SessionRow = { id: string; code: string; name: string; password_hash: string | null; host_id: string | null; settings: string; closed: number; created_at: number };
type ParticipantRow = { id: string; session_id: string; name: string; role: string; status: string; perms: string; created_at: number };

const toSession = (r: SessionRow): Session => ({
  id: r.id, code: r.code, name: r.name, passwordHash: r.password_hash, hostId: r.host_id,
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(r.settings) }, createdAt: r.created_at, closed: !!r.closed,
});
const toParticipant = (r: ParticipantRow): Participant => ({
  id: r.id, sessionId: r.session_id, name: r.name, role: r.role as Role, status: r.status as Status,
  perms: { ...DEFAULT_PERMS, ...JSON.parse(r.perms) }, createdAt: r.created_at,
});

export class SessionService {
  constructor(private db: DB) {}

  createSession(input: z.infer<typeof createSessionSchema>): { session: Session; host: Participant } {
    const now = Date.now();
    const id = newId();
    let code = generateCode();
    for (let i = 0; i < 10 && this.getSessionByCode(code); i++) code = generateCode();
    const hostId = newId();
    const settings: Settings = { ...DEFAULT_SETTINGS, requireApproval: input.requireApproval ?? true };
    const hash = input.password ? hashPassword(input.password) : null;
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO sessions (id, code, name, password_hash, host_id, settings, closed, created_at) VALUES (?,?,?,?,?,?,0,?)')
        .run(id, code, input.name, hash, hostId, JSON.stringify(settings), now);
      this.db.prepare('INSERT INTO participants (id, session_id, name, role, status, perms, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(hostId, id, input.hostName, 'host', 'approved', JSON.stringify({ ...DEFAULT_PERMS, canDraw: true }), now);
    });
    tx();
    return { session: this.getSessionById(id)!, host: this.getParticipant(hostId)! };
  }

  getSessionByCode(code: string): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE code = ?').get(String(code).toUpperCase()) as SessionRow | undefined;
    return r ? toSession(r) : null;
  }
  getSessionById(id: string): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return r ? toSession(r) : null;
  }
  getParticipant(id: string): Participant | null {
    const r = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as ParticipantRow | undefined;
    return r ? toParticipant(r) : null;
  }
  listParticipants(sessionId: string): Participant[] {
    return (this.db.prepare('SELECT * FROM participants WHERE session_id = ? ORDER BY created_at').all(sessionId) as ParticipantRow[]).map(toParticipant);
  }
  listSessionsHostedBy(hostId: string): Session[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE host_id = ?').all(hostId) as SessionRow[]).map(toSession);
  }

  /** Validate join credentials and register (or reuse) a participant. */
  join(code: string, input: z.infer<typeof joinSchema>): { session: Session; participant: Participant } {
    const session = this.getSessionByCode(code);
    // Same message for unknown code / wrong password avoids confirming which codes exist.
    if (!session) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Classroom code or password is incorrect.');
    if (session.passwordHash && !(input.password && verifyPassword(input.password, session.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Classroom code or password is incorrect.');
    }
    if (session.closed) throw new HttpError(423, 'SESSION_CLOSED', 'The host has closed this classroom.');
    const taken = this.listParticipants(session.id).find(
      (p) => p.status !== 'removed' && p.status !== 'rejected' && p.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (taken) throw new HttpError(409, 'NAME_TAKEN', 'That name is already in use in this classroom. Pick another.');
    const id = newId();
    const status: Status = session.settings.requireApproval ? 'pending' : 'approved';
    this.db.prepare('INSERT INTO participants (id, session_id, name, role, status, perms, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, session.id, input.name, 'participant', status, JSON.stringify(DEFAULT_PERMS), Date.now());
    return { session, participant: this.getParticipant(id)! };
  }

  setStatus(sessionId: string, participantId: string, status: Status): Participant {
    const p = this.requireMember(sessionId, participantId);
    if (p.role === 'host') throw forbidden('The host cannot be changed.');
    this.db.prepare('UPDATE participants SET status = ? WHERE id = ?').run(status, participantId);
    return this.getParticipant(participantId)!;
  }

  setPerms(sessionId: string, participantId: string, patch: Partial<Perms>): Participant {
    const p = this.requireMember(sessionId, participantId);
    if (p.role === 'host') throw forbidden('The host cannot be changed.');
    const perms = { ...p.perms, ...patch };
    this.db.prepare('UPDATE participants SET perms = ? WHERE id = ?').run(JSON.stringify(perms), participantId);
    return this.getParticipant(participantId)!;
  }

  updateSettings(sessionId: string, patch: Partial<Settings>): Session {
    const s = this.getSessionById(sessionId);
    if (!s) throw notFound('Session not found.');
    const settings = { ...s.settings, ...patch };
    this.db.prepare('UPDATE sessions SET settings = ? WHERE id = ?').run(JSON.stringify(settings), sessionId);
    return this.getSessionById(sessionId)!;
  }

  setClosed(sessionId: string, closed: boolean) {
    this.db.prepare('UPDATE sessions SET closed = ? WHERE id = ?').run(closed ? 1 : 0, sessionId);
  }

  private requireMember(sessionId: string, participantId: string): Participant {
    const p = this.getParticipant(participantId);
    // Cross-session isolation: a host may only touch participants of their own session.
    if (!p || p.sessionId !== sessionId) throw badRequest('Unknown participant.');
    return p;
  }
}
