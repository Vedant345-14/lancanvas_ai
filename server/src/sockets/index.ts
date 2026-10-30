import type { Server, Socket } from 'socket.io';
import { z, ZodError } from 'zod';
import type { AppContext } from '../context';
import { can, effective } from '../services/sessions/permissions';
import { permsPatchSchema, settingsPatchSchema } from '../services/sessions/sessionService';
import type { Participant, Session } from '../types';
import { verifyToken } from '../utils/auth';
import { forbidden, HttpError } from '../utils/errors';
import { RateLimiter } from '../utils/rateLimit';

type Ack = (res: Record<string, unknown>) => void;
const ID = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

const schemas = {
  'board:add': z.object({ object: z.unknown() }),
  'board:update': z.object({ id: ID, patch: z.unknown() }),
  'board:remove': z.object({ ids: z.array(ID).min(1).max(500) }),
  'board:clear': z.object({}).passthrough(),
  'board:resync': z.object({}).passthrough(),
  'board:preview': z.object({
    id: ID, kind: z.enum(['pen', 'highlighter']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    strokeWidth: z.number().min(1).max(60), reset: z.boolean().optional(),
    points: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(120),
  }),
  'cursor:move': z.object({ x: z.number().finite(), y: z.number().finite() }),
  'chat:send': z.object({ text: z.string().trim().min(1).max(1000) }),
  'access:request': z.object({}).passthrough(),
  'host:decision': z.object({ participantId: ID, action: z.enum(['approve', 'reject', 'remove']) }),
  'host:setParticipant': z.object({ participantId: ID, perms: permsPatchSchema }),
  'host:setSettings': z.object({ settings: settingsPatchSchema }),
  'host:closeSession': z.object({}).passthrough(),
} as const;

export function attachSockets(io: Server, ctx: AppContext) {
  const { sessions, board, chat, uploads, config } = ctx;
  const online = new Map<string, Set<string>>();
  const requests = new Map<string, number>();
  const leaveTimers = new Map<string, NodeJS.Timeout>();
  const limits = {
    chat: new RateLimiter(8, 10_000),
    board: new RateLimiter(900, 10_000),
    preview: new RateLimiter(600, 10_000),
    cursor: new RateLimiter(400, 10_000),
    admin: new RateLimiter(60, 10_000),
    request: new RateLimiter(3, 30_000),
  };
  const room = (sid: string) => `s:${sid}`;

  const meOf = (s: Session, p: Participant) => ({ id: p.id, name: p.name, role: p.role, status: p.status, perms: p.perms, effective: effective(s, p) });
  const publicSettings = (s: Session) => ({ ...s.settings });

  function publishParticipants(s: Session) {
    const all = sessions.listParticipants(s.id).filter((p) => p.status === 'approved' || p.status === 'pending');
    io.to(`h:${s.id}`).emit('participants:host', all.map((p) => ({
      id: p.id, name: p.name, role: p.role, status: p.status, online: online.has(p.id), perms: p.perms,
      effective: effective(s, p), requested: requests.has(p.id),
    })));
    io.to(room(s.id)).emit('participants:update', all.filter((p) => p.status === 'approved').map((p) => ({
      id: p.id, name: p.name, role: p.role, online: online.has(p.id), canDraw: can(s, p, 'draw'),
    })));
  }
  function pushMeToAll(s: Session) {
    for (const p of sessions.listParticipants(s.id)) if (p.status === 'approved') io.to(`p:${p.id}`).emit('me:update', meOf(s, p));
  }
  function systemMessage(s: Session, text: string) {
    io.to(room(s.id)).emit('chat:message', chat.add(s.id, null, 'System', text, 'system'));
  }
  function initPayload(s: Session, p: Participant) {
    if (p.status !== 'approved') return { pending: true, session: { code: s.code, name: s.name }, me: meOf(s, p) };
    const all = sessions.listParticipants(s.id).filter((x) => x.status === 'approved');
    return {
      pending: false,
      session: { code: s.code, name: s.name, settings: publicSettings(s), closed: s.closed },
      me: meOf(s, p),
      participants: all.map((x) => ({ id: x.id, name: x.name, role: x.role, online: online.has(x.id), canDraw: can(s, x, 'draw') })),
      objects: board.list(s.id),
      chat: can(s, p, 'chat') || p.role === 'host' ? chat.recent(s.id, 200) : [],
    };
  }

  io.use((socket, next) => {
    const claims = verifyToken(config.sessionSecret, socket.handshake.auth?.token);
    if (!claims) return next(new Error('unauthorized'));
    const p = sessions.getParticipant(claims.pid);
    const s = p && sessions.getSessionById(p.sessionId);
    if (!p || !s || p.sessionId !== claims.sid) return next(new Error('unauthorized'));
    if (p.status === 'removed' || p.status === 'rejected') return next(new Error('access_denied'));
    if (s.closed && p.role !== 'host') return next(new Error('session_closed'));
    socket.data.pid = p.id;
    socket.data.sid = s.id;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const pid: string = socket.data.pid;
    const sid: string = socket.data.sid;
    const first = sessions.getParticipant(pid)!;
    const sess = sessions.getSessionById(sid)!;

    socket.join(`p:${pid}`);
    if (first.status === 'approved') socket.join(room(sid));
    if (first.role === 'host') socket.join(`h:${sid}`);

    const set = online.get(pid) ?? new Set<string>();
    const wasOffline = set.size === 0;
    set.add(socket.id);
    online.set(pid, set);

    socket.emit('session:init', initPayload(sess, first));
    if (first.status === 'approved' && wasOffline) {
      const t = leaveTimers.get(pid);
      if (t) { clearTimeout(t); leaveTimers.delete(pid); } // quick reconnect: no leave/join noise
      else if (first.role !== 'host') systemMessage(sess, `${first.name} joined`);
    }
    if (first.status === 'pending') io.to(`h:${sid}`).emit('join:request', { id: first.id, name: first.name });
    publishParticipants(sess);

    /** Wraps a handler: rate limit -> validate payload -> re-read authoritative state -> run -> ack. */
    function on<K extends keyof typeof schemas>(
      ev: K, limiter: RateLimiter,
      fn: (a: { s: Session; p: Participant; data: z.infer<(typeof schemas)[K]> }) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>,
    ) {
      socket.on(ev as string, async (raw: unknown, ack?: Ack) => {
        const cb: Ack = typeof ack === 'function' ? ack : () => {};
        try {
          if (!limiter.allow(pid)) throw new HttpError(429, 'RATE_LIMITED', 'You are doing that too quickly.');
          const data = schemas[ev].parse(raw ?? {}) as z.infer<(typeof schemas)[K]>;
          const p = sessions.getParticipant(pid);
          const s = sessions.getSessionById(sid);
          if (!p || !s || p.sessionId !== sid || p.status !== 'approved') throw forbidden('You are not an approved participant.');
          if (s.closed && p.role !== 'host') throw new HttpError(423, 'SESSION_CLOSED', 'The classroom is closed.');
          const out = (await fn({ s, p, data })) ?? {};
          cb({ ok: true, ...out });
        } catch (e) {
          if (e instanceof HttpError) cb({ ok: false, code: e.code, error: e.code === 'FORBIDDEN' && ev.startsWith('board:') ? 'You currently have view-only access.' : e.message });
          else if (e instanceof ZodError) cb({ ok: false, code: 'BAD_REQUEST', error: 'Invalid data.' });
          else { console.error(`[socket] ${ev} failed`, e); cb({ ok: false, code: 'INTERNAL', error: 'Something went wrong.' }); }
        }
      });
    }
    const needHost = (p: Participant) => { if (!can(sessions.getSessionById(sid)!, p, 'manage')) throw forbidden('Only the host can do that.'); };
    const needDraw = (s: Session, p: Participant) => {
      if (!can(s, p, 'draw')) throw forbidden('You currently have view-only access.');
    };

    // ---------- Board ----------
    on('board:add', limits.board, ({ s, p, data }) => {
      needDraw(s, p);
      const raw = data.object as { type?: string };
      if (raw && typeof raw === 'object' && raw.type === 'image' && !can(s, p, 'upload')) throw forbidden('You do not have permission to add images.');
      const obj = board.add(s.id, data.object, p.name, (src) => uploads.exists(s.id, src));
      io.to(room(s.id)).emit('board:added', obj);
      return { object: obj };
    });
    on('board:update', limits.board, ({ s, p, data }) => {
      needDraw(s, p);
      const obj = board.update(s.id, data.id, data.patch);
      socket.to(room(s.id)).emit('board:updated', { id: obj.id, patch: data.patch });
      return { z: obj.z };
    });
    on('board:remove', limits.board, ({ s, p, data }) => {
      needDraw(s, p);
      const removed = board.remove(s.id, data.ids);
      if (removed.length) io.to(room(s.id)).emit('board:removed', { ids: removed });
      return { removed };
    });
    on('board:clear', limits.admin, ({ s, p }) => {
      if (!can(s, p, 'clear')) throw forbidden('Only the host can clear the whole board.');
      board.clear(s.id);
      io.to(room(s.id)).emit('board:cleared', { by: p.name });
      systemMessage(s, `${p.name} cleared the board`);
    });
    on('board:resync', limits.admin, ({ s }) => ({ objects: board.list(s.id) }));
    on('board:preview', limits.preview, ({ s, p, data }) => {
      needDraw(s, p);
      socket.to(room(s.id)).emit('board:preview', { ...data, by: p.id });
    });
    on('cursor:move', limits.cursor, ({ s, p, data }) => {
      socket.to(room(s.id)).volatile.emit('cursor:move', { id: p.id, name: p.name, x: data.x, y: data.y });
    });

    // ---------- Chat ----------
    on('chat:send', limits.chat, ({ s, p, data }) => {
      if (!can(s, p, 'chat')) throw forbidden('Chat is turned off for you.');
      const m = chat.add(s.id, p.id, p.name, data.text);
      io.to(room(s.id)).emit('chat:message', m);
      return { id: m.id };
    });

    // ---------- Access requests ----------
    on('access:request', limits.request, ({ s, p }) => {
      if (!can(s, p, 'request')) throw forbidden('You cannot request access right now.');
      requests.set(p.id, Date.now());
      io.to(`h:${s.id}`).emit('access:requested', { id: p.id, name: p.name });
      publishParticipants(s);
    });

    // ---------- Host controls ----------
    on('host:decision', limits.admin, async ({ s, p, data }) => {
      needHost(p);
      const target = sessions.getParticipant(data.participantId);
      if (!target || target.sessionId !== s.id) throw new HttpError(400, 'BAD_REQUEST', 'Unknown participant.');
      if (target.role === 'host') throw forbidden('The host cannot be changed.');
      if (data.action === 'approve') {
        if (target.status !== 'pending') throw new HttpError(400, 'BAD_REQUEST', 'That participant is not waiting for approval.');
        sessions.setStatus(s.id, target.id, 'approved');
        for (const rs of await io.in(`p:${target.id}`).fetchSockets()) { rs.join(room(s.id)); rs.emit('session:init', initPayload(s, sessions.getParticipant(target.id)!)); }
        systemMessage(s, `${target.name} joined`);
      } else {
        sessions.setStatus(s.id, target.id, data.action === 'reject' ? 'rejected' : 'removed');
        requests.delete(target.id);
        for (const rs of await io.in(`p:${target.id}`).fetchSockets()) {
          rs.emit('access:revoked', { reason: data.action === 'reject' ? 'The host declined your request to join.' : 'The host removed you from the classroom.' });
          rs.disconnect(true);
        }
        if (data.action === 'remove') systemMessage(s, `${target.name} was removed by the host`);
      }
      publishParticipants(s);
    });
    on('host:setParticipant', limits.admin, ({ s, p, data }) => {
      needHost(p);
      const target = sessions.getParticipant(data.participantId);
      if (!target || target.sessionId !== s.id) throw new HttpError(400, 'BAD_REQUEST', 'Unknown participant.');
      if (target.status !== 'approved') throw new HttpError(400, 'BAD_REQUEST', 'Approve this participant first.');
      const updated = sessions.setPerms(s.id, target.id, data.perms);
      if (data.perms.canDraw !== undefined) requests.delete(target.id);
      io.to(`p:${target.id}`).emit('me:update', meOf(s, updated));
      if (data.perms.canDraw !== undefined) io.to(`p:${target.id}`).emit('notice', { text: data.perms.canDraw ? 'The host gave you drawing access.' : 'Your drawing access was removed.' });
      publishParticipants(s);
    });
    on('host:setSettings', limits.admin, ({ s, p, data }) => {
      needHost(p);
      const next = sessions.updateSettings(s.id, data.settings);
      io.to(room(s.id)).emit('settings:update', publicSettings(next));
      pushMeToAll(next);
      if (data.settings.locked !== undefined) systemMessage(next, data.settings.locked ? 'The host locked the board' : 'The host unlocked the board');
      if (data.settings.drawPolicy !== undefined) {
        const label = { none: 'nobody can draw', everyone: 'everyone can draw', selected: 'only selected participants can draw' }[data.settings.drawPolicy];
        systemMessage(next, `Drawing policy changed: ${label}`);
      }
      publishParticipants(next);
    });
    on('host:closeSession', limits.admin, async ({ s, p }) => {
      needHost(p);
      sessions.setClosed(s.id, true);
      io.to(room(s.id)).emit('session:closed', { reason: 'The host closed the classroom.' });
      for (const rs of await io.in(room(s.id)).fetchSockets()) if (rs.data.pid !== p.id) rs.disconnect(true);
    });

    socket.on('disconnect', () => {
      const set2 = online.get(pid);
      set2?.delete(socket.id);
      if (set2 && set2.size === 0) {
        online.delete(pid);
        const s = sessions.getSessionById(sid);
        const p = sessions.getParticipant(pid);
        if (!s || !p) return;
        if (p.status === 'approved' && p.role !== 'host') {
          leaveTimers.set(pid, setTimeout(() => {
            leaveTimers.delete(pid);
            if (!online.has(pid)) { const cur = sessions.getSessionById(sid); const cp = sessions.getParticipant(pid); if (cur && cp?.status === 'approved') systemMessage(cur, `${cp.name} left`); }
          }, 4000));
        }
        publishParticipants(s);
      }
    });
  });

  return { online, shutdown: () => { for (const t of leaveTimers.values()) clearTimeout(t); } };
}
