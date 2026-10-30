import { useCallback, useEffect, useRef, useState } from 'react';
import type { Classroom } from '../../hooks/useClassroom';
import { api } from '../../services/api';
import type { Auth, BoardObject, Tool } from '../../types';
import type { BoardHistory } from './useBoardHistory';
import { bboxOf, drawObject, FONT, getImage, lighten, measure, newId, STICKY_FONT, topHit } from './render';

export interface View { x: number; y: number; k: number }
interface Props {
  cl: Classroom; auth: Auth; hist: BoardHistory; tool: Tool; color: string; width: number; fill: boolean;
  view: View; setView: (v: View) => void; selectedId: string | null; setSelectedId: (id: string | null) => void;
  onDropFile: (file: File, at: { x: number; y: number }) => void;
}
interface Editing { id?: string; kind: 'text' | 'sticky'; x: number; y: number; w: number; h: number; text: string; fontSize: number; color: string }
type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'pinch'; d0: number; k0: number; cx: number; cy: number; ox: number; oy: number }
  | { kind: 'draw'; sentIdx: number; lastSend: number }
  | { kind: 'shape' }
  | { kind: 'move'; sx: number; sy: number; orig: BoardObject }
  | { kind: 'resize'; handle: string; orig: BoardObject }
  | { kind: 'erase'; ids: Set<string> }
  | { kind: 'place'; sx: number; sy: number; wx: number; wy: number };

const HANDLE_PX = 9;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function handlesOf(o: BoardObject): { name: string; x: number; y: number }[] {
  if (o.type === 'pen' || o.type === 'highlighter') return [];
  if (o.type === 'line' || o.type === 'arrow') return [{ name: 'start', x: o.x, y: o.y }, { name: 'end', x: o.x + (o.w ?? 0), y: o.y + (o.h ?? 0) }];
  const b = bboxOf(o);
  return [{ name: 'nw', x: b.x, y: b.y }, { name: 'ne', x: b.x + b.w, y: b.y }, { name: 'sw', x: b.x, y: b.y + b.h }, { name: 'se', x: b.x + b.w, y: b.y + b.h }];
}

export default function Board(p: Props) {
  const { cl, auth, hist } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const drag = useRef<Drag | null>(null);
  const draft = useRef<BoardObject | null>(null);
  const erasing = useRef<Set<string>>(new Set());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const spaceDown = useRef(false);
  const lastCursor = useRef(0);
  const lastWarn = useRef(0);
  const raf = useRef(0);
  const cancelEdit = useRef(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const canDraw = cl.me?.effective.draw ?? false;

  const L = useRef({ ...p, editing, canDraw });
  L.current = { ...p, editing, canDraw };

  const drawNow = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const { cl, auth, view, selectedId, editing } = L.current;
    const ctx = c.getContext('2d')!; const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
    if (view.k > 0.3) { // dot grid
      const step = 32 * view.k; const ox = ((view.x % step) + step) % step, oy = ((view.y % step) + step) % step;
      ctx.fillStyle = '#D9DEEA';
      for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
    const imgFor = (src: string) => getImage(api.fileUrl(auth, src), requestDraw);
    for (const o of cl.objects) { if ((editing && editing.id === o.id) || erasing.current.has(o.id)) continue; drawObject(ctx, o, imgFor); }
    for (const pv of cl.previews.current.values()) drawObject(ctx, { id: pv.id, type: pv.kind, x: 0, y: 0, points: pv.points, color: pv.color, strokeWidth: pv.strokeWidth }, imgFor);
    if (draft.current) drawObject(ctx, draft.current, imgFor);
    const sel = selectedId ? cl.objects.find((o) => o.id === selectedId) : null;
    if (sel && !(editing && editing.id === sel.id)) {
      const b = bboxOf(sel); const pad = 4 / view.k;
      ctx.strokeStyle = '#4263EB'; ctx.lineWidth = 1.5 / view.k; ctx.setLineDash([6 / view.k, 4 / view.k]);
      if (sel.type !== 'line' && sel.type !== 'arrow') ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]); ctx.fillStyle = '#fff';
      for (const hd of handlesOf(sel)) { const r = 5 / view.k; ctx.beginPath(); ctx.arc(hd.x, hd.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
    // remote cursors (screen space)
    ctx.font = FONT(12);
    for (const cu of cl.cursors.current.values()) {
      const sx = cu.x * view.k + view.x, sy = cu.y * view.k + view.y;
      ctx.fillStyle = '#14B8A6'; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 11, sy + 4); ctx.lineTo(sx + 4, sy + 11); ctx.closePath(); ctx.fill();
      const tw = ctx.measureText(cu.name).width + 10;
      ctx.beginPath(); ctx.roundRect(sx + 10, sy + 10, tw, 18, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(cu.name, sx + 15, sy + 19.5);
    }
  }, []);
  const requestDraw = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; drawNow(); }); }, [drawNow]);

  useEffect(() => { requestDraw(); }, [cl.objects, cl.drawTick, p.view, p.selectedId, editing, requestDraw]);

  // resize observer
  useEffect(() => {
    const el = wrapRef.current!, c = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      c.width = Math.max(1, Math.floor(r.width * dpr)); c.height = Math.max(1, Math.floor(r.height * dpr));
      c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; requestDraw();
    });
    ro.observe(el); return () => ro.disconnect();
  }, [requestDraw]);

  // wheel: ctrl/cmd = zoom at cursor, otherwise pan
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); const v = L.current.view; const r = c.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.01), 0.1, 5); const sx = e.clientX - r.left, sy = e.clientY - r.top;
        L.current.setView({ k, x: sx - ((sx - v.x) / v.k) * k, y: sy - ((sy - v.y) / v.k) * k });
      } else L.current.setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    c.addEventListener('wheel', onWheel, { passive: false }); return () => c.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { spaceDown.current = true; if (e.target === document.body) e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect(); const v = L.current.view;
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k, sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const warnViewOnly = () => { if (Date.now() - lastWarn.current > 2500) { lastWarn.current = Date.now(); cl.toast('You currently have view-only access.', 'error'); } };

  const openEditor = (ed: Editing) => { cancelEdit.current = false; p.setSelectedId(null); setEditing(ed); };

  const commitEdit = () => {
    const ed = L.current.editing; if (!ed) return;
    setEditing(null);
    if (cancelEdit.current) { cancelEdit.current = false; return; }
    const text = ed.text.replace(/\s+$/, '');
    if (!ed.id) {
      if (!text.trim()) return;
      if (ed.kind === 'text') {
        const m = measure(text, ed.fontSize);
        hist.add({ id: newId(), type: 'text', x: ed.x, y: ed.y, w: m.w + 8, h: m.h + 8, text, fontSize: ed.fontSize, color: ed.color, strokeWidth: 1 });
      } else hist.add({ id: newId(), type: 'sticky', x: ed.x, y: ed.y, w: ed.w, h: ed.h, text, fontSize: STICKY_FONT, color: ed.color, fill: lighten(ed.color, 0.8), strokeWidth: 1 });
      return;
    }
    const o = L.current.cl.objects.find((x) => x.id === ed.id); if (!o || text === (o.text ?? '') || !text.trim()) return;
    const before: Partial<BoardObject> = { text: o.text, w: o.w, h: o.h }; const after: Partial<BoardObject> = { text };
    if (o.type === 'text') { const m = measure(text, o.fontSize ?? 22); after.w = m.w + 8; after.h = m.h + 8; }
    L.current.cl.updateObject(o.id, after, true); hist.recordUpdate(o.id, before, after);
  };

  const eraseAt = (wx: number, wy: number, d: Extract<Drag, { kind: 'erase' }>) => {
    const v = L.current.view;
    const hit = topHit(L.current.cl.objects.filter((o) => !d.ids.has(o.id)), wx, wy, 8 / v.k);
    if (hit) { d.ids.add(hit.id); erasing.current = d.ids; requestDraw(); }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvasRef.current!; c.setPointerCapture(e.pointerId);
    const w = toWorld(e); pointers.current.set(e.pointerId, { x: w.sx, y: w.sy });
    const v = L.current.view;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      draft.current = null; erasing.current = new Set();
      drag.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: v.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ox: v.x, oy: v.y };
      return;
    }
    if (pointers.current.size > 2) return;
    let tool = L.current.tool;
    const panWanted = e.button === 1 || spaceDown.current || tool === 'pan' || !L.current.canDraw;
    if (panWanted) {
      if (!L.current.canDraw && tool !== 'pan' && tool !== 'select' && e.button === 0) warnViewOnly();
      drag.current = { kind: 'pan', sx: w.sx, sy: w.sy, ox: v.x, oy: v.y }; return;
    }
    if (e.button !== 0) return;
    const { color, width, fill } = L.current;
    switch (tool) {
      case 'select': {
        const sel = L.current.selectedId ? L.current.cl.objects.find((o) => o.id === L.current.selectedId) : null;
        if (sel) {
          const hd = handlesOf(sel).find((h) => Math.hypot(h.x - w.x, h.y - w.y) <= (HANDLE_PX + 3) / v.k);
          if (hd) { drag.current = { kind: 'resize', handle: hd.name, orig: sel }; return; }
        }
        const hit = topHit(L.current.cl.objects, w.x, w.y, 8 / v.k);
        if (hit) { p.setSelectedId(hit.id); drag.current = { kind: 'move', sx: w.x, sy: w.y, orig: hit }; }
        else { p.setSelectedId(null); drag.current = { kind: 'pan', sx: w.sx, sy: w.sy, ox: v.x, oy: v.y }; }
        return;
      }
      case 'pen': case 'highlighter': {
        const sw = tool === 'highlighter' ? Math.max(width * 4, 14) : width;
        draft.current = { id: newId(), type: tool, x: 0, y: 0, points: [[w.x, w.y]], color, strokeWidth: sw };
        drag.current = { kind: 'draw', sentIdx: 0, lastSend: 0 }; requestDraw(); return;
      }
      case 'eraser': { const d = { kind: 'erase' as const, ids: new Set<string>() }; drag.current = d; eraseAt(w.x, w.y, d); return; }
      case 'line': case 'arrow': case 'rect': case 'ellipse':
        draft.current = { id: newId(), type: tool, x: w.x, y: w.y, w: 0, h: 0, color, strokeWidth: width, fill: fill && (tool === 'rect' || tool === 'ellipse') ? lighten(color, 0.85) : null };
        drag.current = { kind: 'shape' }; return;
      case 'text': case 'sticky': drag.current = { kind: 'place', sx: w.sx, sy: w.sy, wx: w.x, wy: w.y }; return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e); const d = drag.current; const v = L.current.view;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: w.sx, y: w.sy });
    const now = Date.now();
    if (now - lastCursor.current > 60 && !(d && d.kind === 'pinch')) { lastCursor.current = now; cl.emitCursor(w.x, w.y); }
    if (!d) return;
    switch (d.kind) {
      case 'pinch': {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const k = clamp(d.k0 * (dist / d.d0), 0.1, 5); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        p.setView({ k, x: cx - ((d.cx - d.ox) / d.k0) * k, y: cy - ((d.cy - d.oy) / d.k0) * k }); break;
      }
      case 'pan': p.setView({ ...v, x: d.ox + (w.sx - d.sx), y: d.oy + (w.sy - d.sy) }); break;
      case 'draw': {
        const o = draft.current!; const pts = o.points!; const last = pts[pts.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * v.k >= 1.5) { pts.push([w.x, w.y]); requestDraw(); }
        if (now - d.lastSend > 50 && pts.length > d.sentIdx) {
          const chunk = pts.slice(d.sentIdx, d.sentIdx + 120);
          cl.emitPreview({ id: o.id, kind: o.type as 'pen' | 'highlighter', color: o.color, strokeWidth: o.strokeWidth, points: chunk, reset: d.sentIdx === 0 });
          d.sentIdx += chunk.length; d.lastSend = now;
        }
        break;
      }
      case 'shape': { const o = draft.current!; o.w = w.x - o.x; o.h = w.y - o.y; requestDraw(); break; }
      case 'move': cl.updateObject(d.orig.id, { x: d.orig.x + (w.x - d.sx), y: d.orig.y + (w.y - d.sy) }, false); break;
      case 'resize': cl.updateObject(d.orig.id, resizePatch(d.orig, d.handle, w.x, w.y), false); break;
      case 'erase': eraseAt(w.x, w.y, d); break;
      case 'place': break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const w = toWorld(e); const d = drag.current; const v = L.current.view;
    pointers.current.delete(e.pointerId);
    if (!d) return;
    if (d.kind === 'pinch') { if (pointers.current.size < 2) drag.current = null; return; }
    drag.current = null;
    switch (d.kind) {
      case 'draw': {
        const o = draft.current; draft.current = null; if (!o) break;
        let pts = o.points!; if (pts.length > 3500) { const step = Math.ceil(pts.length / 3500); pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1); }
        const rounded = pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
        hist.add({ ...o, points: rounded } as BoardObject);
        break;
      }
      case 'shape': {
        const o = draft.current; draft.current = null; if (!o) break;
        const len = Math.hypot(o.w ?? 0, o.h ?? 0) * v.k;
        if (len < 5) { requestDraw(); break; }
        if (o.type === 'rect' || o.type === 'ellipse') { const b = bboxOf(o); o.x = b.x; o.y = b.y; o.w = b.w; o.h = b.h; }
        hist.add(o); break;
      }
      case 'move': case 'resize': {
        const cur = L.current.cl.objects.find((x) => x.id === d.orig.id); if (!cur) break;
        const keys: (keyof BoardObject)[] = ['x', 'y', 'w', 'h', 'fontSize'];
        const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; let changed = false;
        for (const k of keys) if (cur[k] !== undefined && cur[k] !== d.orig[k]) { before[k] = d.orig[k]; after[k] = cur[k]; changed = true; }
        if (changed) { cl.updateObject(cur.id, after as Partial<BoardObject>, true); hist.recordUpdate(cur.id, before as Partial<BoardObject>, after as Partial<BoardObject>); }
        break;
      }
      case 'erase': { const ids = [...d.ids]; erasing.current = new Set(); if (ids.length) hist.remove(ids); requestDraw(); break; }
      case 'place': {
        if (Math.hypot(w.sx - d.sx, w.sy - d.sy) > 6) break;
        const { tool, color } = L.current;
        if (tool === 'text') openEditor({ kind: 'text', x: d.wx, y: d.wy, w: 240, h: 40, text: '', fontSize: 22, color });
        else openEditor({ kind: 'sticky', x: d.wx - 100, y: d.wy - 75, w: 200, h: 150, text: '', fontSize: STICKY_FONT, color: color === '#17233C' ? '#FACC15' : color });
        break;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!L.current.canDraw) return;
    const w = toWorld(e); const hit = topHit(L.current.cl.objects, w.x, w.y, 6 / L.current.view.k);
    if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
      const b = bboxOf(hit);
      openEditor({ id: hit.id, kind: hit.type, x: b.x, y: b.y, w: b.w, h: b.h, text: hit.text ?? '', fontSize: hit.fontSize ?? (hit.type === 'text' ? 22 : STICKY_FONT), color: hit.color });
    }
  };

  const cursor = !canDraw || p.tool === 'pan' ? 'grab' : p.tool === 'select' ? 'default' : p.tool === 'text' ? 'text' : p.tool === 'eraser' ? 'cell' : 'crosshair';
  const v = p.view;
  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-white"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) p.onDropFile(f, toWorld(e)); }}>
      <canvas ref={canvasRef} className="absolute inset-0 touch-none" style={{ cursor }} aria-label="Whiteboard canvas"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()} />
      {editing && (
        <textarea autoFocus value={editing.text} spellCheck={false}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === 'Escape') { cancelEdit.current = true; (e.target as HTMLTextAreaElement).blur(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur(); e.stopPropagation(); }}
          placeholder={editing.kind === 'sticky' ? 'Type a note…' : 'Type text…'}
          aria-label="Edit text"
          className="absolute resize-none rounded border border-brand/60 bg-white/90 p-1 leading-[1.3] outline-none"
          style={{
            left: editing.x * v.k + v.x, top: editing.y * v.k + v.y,
            width: Math.max(editing.w * v.k, editing.kind === 'text' ? 220 : 60), height: Math.max(editing.h * v.k, 40),
            fontSize: editing.fontSize * v.k, color: editing.kind === 'sticky' ? '#17233C' : editing.color, fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
            background: editing.kind === 'sticky' ? lighten(editing.color, 0.8) : 'rgba(255,255,255,.92)', padding: editing.kind === 'sticky' ? 10 * v.k : 4,
          }} />
      )}
    </div>
  );
}

function resizePatch(o: BoardObject, handle: string, px: number, py: number): Partial<BoardObject> {
  if (handle === 'start') return { x: px, y: py, w: o.x + (o.w ?? 0) - px, h: o.y + (o.h ?? 0) - py };
  if (handle === 'end') return { w: px - o.x, h: py - o.y };
  const b = bboxOf(o);
  const west = handle.includes('w'), north = handle.startsWith('n');
  const ax = west ? b.x + b.w : b.x, ay = north ? b.y + b.h : b.y; // fixed (opposite) corner
  if (o.type === 'text') {
    const s = clamp(Math.abs(px - ax) / (b.w || 1), 0.2, 8);
    const nw = b.w * s, nh = b.h * s;
    return { x: west ? ax - nw : ax, y: north ? ay - nh : ay, w: nw, h: nh, fontSize: clamp(Math.round((o.fontSize ?? 22) * s), 8, 160) };
  }
  let nw = Math.max(Math.abs(px - ax), 12), nh = Math.max(Math.abs(py - ay), 12);
  if (o.type === 'image') nh = nw * (b.h / (b.w || 1));
  return { x: west ? ax - nw : ax, y: north ? ay - nh : ay, w: nw, h: nh };
}
