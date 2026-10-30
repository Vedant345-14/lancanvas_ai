import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Auth, BoardObject, ChatMessage, Conn, Cursor, HostPerson, Me, NewObject, Person, Preview, Settings, Toast } from '../types';

export interface Activity { id: number; text: string; at: number }
type Ack = { ok: boolean; error?: string; code?: string; [k: string]: any };

export function useClassroom(auth: Auth | null, onAuthLost: (reason: string) => void) {
  const [conn, setConn] = useState<Conn>('connecting');
  const [pending, setPending] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [classroom, setClassroom] = useState<{ code: string; name: string } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [hostPeople, setHostPeople] = useState<HostPerson[]>([]);
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'error'>('saved');
  const previews = useRef(new Map<string, Preview>());
  const cursors = useRef(new Map<string, Cursor>());
  const [drawTick, setDrawTick] = useState(0); // bumps to repaint on previews/cursors
  const socketRef = useRef<Socket | null>(null);
  const meRef = useRef<Me | null>(null);
  const objectsRef = useRef<BoardObject[]>([]);
  const pendingUpdates = useRef(new Map<string, { patch: Record<string, unknown>; timer: ReturnType<typeof setTimeout> | null }>());
  const toastId = useRef(1);
  const chatTabOpen = useRef(false);
  const lostRef = useRef(onAuthLost);
  lostRef.current = onAuthLost;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3200);
  }, []);
  const log = useCallback((text: string) => setActivity((a) => [{ id: toastId.current++, text, at: Date.now() }, ...a].slice(0, 30)), []);

  const setObjs = useCallback((fn: (o: BoardObject[]) => BoardObject[]) => {
    objectsRef.current = fn(objectsRef.current);
    setObjects(objectsRef.current);
  }, []);
  const upsert = (list: BoardObject[], o: BoardObject) => {
    const i = list.findIndex((x) => x.id === o.id);
    if (i < 0) return [...list, o].sort((a, b) => (a.z ?? 1e12) - (b.z ?? 1e12));
    const copy = list.slice(); copy[i] = { ...list[i], ...o }; return copy;
  };

  useEffect(() => {
    if (!auth) return;
    setConn('connecting'); setClosedReason(null);
    const socket = io({ auth: { token: auth.token }, reconnectionDelayMax: 3000 });
    socketRef.current = socket;

    socket.on('connect', () => setConn('live'));
    socket.on('disconnect', (reason) => setConn(reason === 'io server disconnect' ? 'closed' : 'reconnecting'));
    socket.on('connect_error', (err) => {
      const m = err.message;
      if (m === 'unauthorized' || m === 'access_denied') lostRef.current(m === 'access_denied' ? 'The host removed you from this classroom.' : 'Your session expired. Join again.');
      else if (m === 'session_closed') { setClosedReason('The host has closed this classroom.'); setConn('closed'); socket.disconnect(); }
      else setConn('reconnecting');
    });
    socket.on('session:init', (d) => {
      setClassroom({ code: d.session.code, name: d.session.name });
      setMe(d.me); meRef.current = d.me;
      setPending(!!d.pending);
      if (d.pending) return;
      setSettings(d.session.settings);
      setPeople(d.participants);
      setChat(d.chat);
      objectsRef.current = d.objects; setObjects(d.objects);
      previews.current.clear(); cursors.current.clear();
      setClosedReason(null);
    });
    socket.on('me:update', (m: Me) => { setMe(m); meRef.current = m; });
    socket.on('settings:update', (s: Settings) => setSettings(s));
    socket.on('participants:update', (l: Person[]) => setPeople(l));
    socket.on('participants:host', (l: HostPerson[]) => setHostPeople(l));
    socket.on('board:added', (o: BoardObject) => { previews.current.delete(o.id); setObjs((l) => upsert(l, o)); setDrawTick((t) => t + 1); });
    socket.on('board:updated', ({ id, patch }: { id: string; patch: Partial<BoardObject> }) => setObjs((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o))));
    socket.on('board:removed', ({ ids }: { ids: string[] }) => setObjs((l) => l.filter((o) => !ids.includes(o.id))));
    socket.on('board:cleared', ({ by }: { by: string }) => { setObjs(() => []); toast(`${by} cleared the board`); });
    socket.on('board:preview', (p: Omit<Preview, 't'> & { reset?: boolean }) => {
      const cur = previews.current.get(p.id);
      const pts = p.reset || !cur ? p.points : [...cur.points, ...p.points];
      previews.current.set(p.id, { ...p, points: pts, t: Date.now() });
      setDrawTick((t) => t + 1);
    });
    socket.on('cursor:move', (c: Omit<Cursor, 't'>) => { cursors.current.set(c.id, { ...c, t: Date.now() }); setDrawTick((t) => t + 1); });
    socket.on('chat:message', (m: ChatMessage) => {
      setChat((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      if (m.kind === 'system') log(m.text);
      else if (!chatTabOpen.current && m.participantId !== meRef.current?.id) setUnread((n) => n + 1);
    });
    socket.on('join:request', (r: { name: string }) => log(`${r.name} is waiting for approval`));
    socket.on('access:requested', (r: { name: string }) => { toast(`${r.name} requested drawing access`); log(`${r.name} requested drawing access`); });
    socket.on('notice', (n: { text: string }) => toast(n.text, 'info'));
    socket.on('access:revoked', (r: { reason: string }) => lostRef.current(r.reason));
    socket.on('session:closed', (r: { reason: string }) => { setClosedReason(r.reason); setConn('closed'); });

    const sweep = setInterval(() => {
      const now = Date.now(); let changed = false;
      for (const [k, v] of cursors.current) if (now - v.t > 5000) { cursors.current.delete(k); changed = true; }
      for (const [k, v] of previews.current) if (now - v.t > 6000) { previews.current.delete(k); changed = true; }
      if (changed) setDrawTick((t) => t + 1);
    }, 2000);

    return () => { clearInterval(sweep); socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [auth?.token, auth?.code, setObjs, toast, log]);

  const emit = useCallback((ev: string, data: unknown = {}): Promise<Ack> => new Promise((resolve) => {
    const s = socketRef.current;
    if (!s || !s.connected) return resolve({ ok: false, error: 'Not connected to the classroom.' });
    s.timeout(8000).emit(ev, data, (err: Error | null, res: Ack) => resolve(err ? { ok: false, error: 'The server did not respond.' } : res));
  }), []);

  const track = useCallback(async (p: Promise<Ack>, rollback?: () => void): Promise<boolean> => {
    setSaving('saving');
    const r = await p;
    if (!r.ok) {
      setSaving('error'); rollback?.();
      toast(r.error ?? 'That action was rejected.', 'error');
      if (r.code === 'FORBIDDEN' || r.code === 'BAD_REQUEST') void emit('board:resync').then((x) => { if (x.ok) setObjs(() => x.objects); });
      return false;
    }
    setSaving('saved'); return true;
  }, [emit, toast, setObjs]);

  const addObject = useCallback((o: NewObject): Promise<boolean> => {
    const m = meRef.current;
    const z = Math.max(0, ...objectsRef.current.map((x) => x.z ?? 0)) + 1;
    setObjs((l) => upsert(l, { ...o, author: m?.name, z, ts: Date.now() }));
    return track(emit('board:add', { object: o }), () => setObjs((l) => l.filter((x) => x.id !== o.id)));
  }, [emit, track, setObjs]);

  /** Local-first update; network sends are throttled while dragging and flushed when `final`. */
  const updateObject = useCallback((id: string, patch: Partial<BoardObject>, final = true) => {
    setObjs((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    const entry = pendingUpdates.current.get(id) ?? { patch: {}, timer: null };
    entry.patch = { ...entry.patch, ...patch };
    pendingUpdates.current.set(id, entry);
    const flush = () => {
      const e = pendingUpdates.current.get(id); if (!e) return;
      if (e.timer) clearTimeout(e.timer);
      pendingUpdates.current.delete(id);
      void track(emit('board:update', { id, patch: e.patch }));
    };
    if (final) flush(); else if (!entry.timer) entry.timer = setTimeout(flush, 70);
  }, [emit, track, setObjs]);

  const removeObjects = useCallback((ids: string[]) => {
    if (!ids.length) return Promise.resolve(true);
    const prev = objectsRef.current.filter((o) => ids.includes(o.id));
    setObjs((l) => l.filter((o) => !ids.includes(o.id)));
    return track(emit('board:remove', { ids }), () => setObjs((l) => [...l, ...prev]));
  }, [emit, track, setObjs]);

  const clearBoard = useCallback(() => track(emit('board:clear')), [emit, track]);
  const sendChat = useCallback((text: string) => emit('chat:send', { text }).then((r) => { if (!r.ok) toast(r.error ?? 'Message not sent.', 'error'); return r.ok; }), [emit, toast]);
  const emitPreview = useCallback((p: { id: string; kind: 'pen' | 'highlighter'; color: string; strokeWidth: number; points: [number, number][]; reset?: boolean }) => { socketRef.current?.emit('board:preview', p, () => {}); }, []);
  const emitCursor = useCallback((x: number, y: number) => { socketRef.current?.volatile.emit('cursor:move', { x, y }, () => {}); }, []);
  const hostAction = useCallback(async (ev: string, data: unknown) => { const r = await emit(ev, data); if (!r.ok) toast(r.error ?? 'Action failed.', 'error'); return r.ok; }, [emit, toast]);
  const requestAccess = useCallback(async () => {
    const r = await emit('access:request');
    toast(r.ok ? 'Request sent to the host.' : r.error ?? 'Could not send the request.', r.ok ? 'success' : 'error');
  }, [emit, toast]);
  const setChatOpen = useCallback((open: boolean) => { chatTabOpen.current = open; if (open) setUnread(0); }, []);

  return {
    conn, pending, closedReason, classroom, settings, me, people, hostPeople, objects, chat, unread, toasts, activity, saving, drawTick,
    previews, cursors, toast, addObject, updateObject, removeObjects, clearBoard, sendChat, emitPreview, emitCursor, hostAction, requestAccess, setChatOpen,
    dismissToast: (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
  };
}
export type Classroom = ReturnType<typeof useClassroom>;
