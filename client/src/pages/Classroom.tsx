import { Bot, Check, ChevronsRight, Copy, LayoutDashboard, LogOut, MessageSquare, Minus, PanelRightOpen, Plus, ShieldCheck, Users, Maximize2, WifiOff, Lock, Hand } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, copyText, Logo, Modal } from '../components/ui';
import AiNotesPanel from '../features/ai-notes/AiNotesPanel';
import ChatPanel from '../features/chat/ChatPanel';
import ParticipantsPanel from '../features/participants/ParticipantsPanel';
import PermissionsDialog from '../features/participants/PermissionsDialog';
import Board, { View } from '../features/whiteboard/Board';
import { bboxOf, newId } from '../features/whiteboard/render';
import Toolbar from '../features/whiteboard/Toolbar';
import { useBoardHistory } from '../features/whiteboard/useBoardHistory';
import type { Classroom as Cl } from '../hooks/useClassroom';
import { api } from '../services/api';
import type { Auth, Tool } from '../types';

type Tab = 'chat' | 'people' | 'ai';
const COLORS = ['#17233C', '#E03131', '#F08C00', '#2F9E44', '#4263EB', '#7048E8', '#14B8A6', '#868E96'];
const WIDTHS = [2, 4, 8, 14];
const KEYS: Record<string, Tool> = { v: 'select', p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', n: 'sticky' };

export default function Classroom({ cl, auth, onDashboard, onLeave }: { cl: Cl; auth: Auth; onDashboard?: () => void; onLeave: () => void }) {
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [fill, setFill] = useState(false);
  const [view, setView] = useState<View>({ x: 80, y: 60, k: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth >= 1000);
  const [wide, setWide] = useState(false);
  const [perms, setPerms] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [requested, setRequested] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const boardWrap = useRef<HTMLDivElement>(null);
  const hist = useBoardHistory(cl);
  const eff = cl.me?.effective;
  const canDraw = !!eff?.draw;
  const isHost = cl.me?.role === 'host';

  useEffect(() => { cl.setChatOpen(sideOpen && tab === 'chat'); }, [sideOpen, tab, cl.setChatOpen]); // eslint-disable-line
  useEffect(() => { if (!canDraw && tool !== 'select' && tool !== 'pan') setTool('pan'); if (canDraw) setRequested(false); }, [canDraw]); // eslint-disable-line
  useEffect(() => { if (selectedId && !cl.objects.some((o) => o.id === selectedId)) setSelectedId(null); }, [cl.objects, selectedId]);

  const denied = useCallback(() => cl.toast('You currently have view-only access.', 'error'), [cl.toast]);

  const uploadImage = useCallback(async (file: File, at?: { x: number; y: number }) => {
    if (!eff?.upload) return denied();
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return cl.toast('Only PNG, JPEG and WebP images are supported.', 'error');
    if (file.size > 5 * 1024 * 1024) return cl.toast('That image is larger than 5 MB.', 'error');
    try {
      const { src } = await api.upload(auth, file);
      const url = api.fileUrl(auth, src);
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 420 / dims.w, 420 / dims.h); const w = Math.round(dims.w * s), h = Math.round(dims.h * s);
      const r = boardWrap.current?.getBoundingClientRect();
      const cx = at?.x ?? ((r ? r.width / 2 : 400) - view.x) / view.k, cy = at?.y ?? ((r ? r.height / 2 : 300) - view.y) / view.k;
      hist.add({ id: newId(), type: 'image', x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, src, color: '#000000', strokeWidth: 1 });
      cl.toast('Image added.', 'success');
    } catch (e) { cl.toast((e as Error).message || 'Upload failed.', 'error'); }
  }, [eff?.upload, auth, view, hist, cl, denied]);

  const fit = () => {
    const r = boardWrap.current?.getBoundingClientRect(); if (!r) return;
    if (!cl.objects.length) return setView({ x: 80, y: 60, k: 1 });
    const bs = cl.objects.map(bboxOf);
    const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y)), x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h));
    const k = Math.min(2, Math.max(0.1, Math.min((r.width - 120) / (x2 - x1 || 1), (r.height - 120) / (y2 - y1 || 1))));
    setView({ k, x: (r.width - (x2 - x1) * k) / 2 - x1 * k, y: (r.height - (y2 - y1) * k) / 2 - y1 * k });
  };
  const zoom = (f: number) => { const r = boardWrap.current!.getBoundingClientRect(); const k = Math.min(5, Math.max(0.1, view.k * f)); const cx = r.width / 2, cy = r.height / 2; setView({ k, x: cx - ((cx - view.x) / view.k) * k, y: cy - ((cy - view.y) / view.k) * k }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); void (e.shiftKey ? hist.redo() : hist.undo()); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); void hist.redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { if (canDraw) { hist.remove([selectedId]); setSelectedId(null); } else denied(); }
      else if (e.key === 'Escape') setSelectedId(null);
      else if (!mod && !e.altKey && KEYS[e.key.toLowerCase()]) { const k = KEYS[e.key.toLowerCase()]; if (k === 'select' || canDraw) setTool(k); else denied(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [hist, selectedId, canDraw, denied]);

  const requestAccess = async () => { await cl.requestAccess(); setRequested(true); };
  const status = { live: ['Live', 'bg-green-500', 'text-green-700 bg-green-50'], connecting: ['Connecting', 'bg-amber-400 pulse-dot', 'text-amber-700 bg-amber-50'], reconnecting: ['Reconnecting', 'bg-amber-400 pulse-dot', 'text-amber-700 bg-amber-50'], closed: ['Disconnected', 'bg-red-500', 'text-red-700 bg-red-50'] }[cl.conn];
  const [copied, setCopied] = useState(false);
  const openTab = (t: Tab) => { setTab(t); setSideOpen(true); };
  const showOptions = canDraw && ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text', 'sticky'].includes(tool);
  const online = cl.people.filter((p) => p.online);

  return (
    <div className="flex h-full flex-col bg-canvasbg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-100 bg-white px-3 md:px-4">
        <div className="hidden sm:block"><Logo size={26} /></div>
        <div className="hidden h-6 w-px bg-ink-100 sm:block" />
        <div className="min-w-0"><div className="truncate text-sm font-semibold">{cl.classroom?.name}</div></div>
        <span className={`chip ${status[2]}`} role="status"><span className={`h-2 w-2 rounded-full ${status[1]}`} />{status[0]}</span>
        <button className="chip hidden bg-ink-50 font-mono text-ink-700 hover:bg-ink-100 md:inline-flex" title="Copy classroom code" onClick={async () => { await copyText(auth.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {auth.code} {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        <div className="flex-1" />
        <div className="hidden items-center -space-x-2 md:flex" aria-label={`${online.length} online`}>
          {online.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} size={28} ring />)}
          {online.length > 5 && <span className="ml-1 pl-3 text-xs text-ink-500">+{online.length - 5}</span>}
        </div>
        <span className="hidden text-xs text-ink-500 lg:inline" aria-live="polite">{cl.saving === 'saving' ? 'Saving…' : cl.saving === 'error' ? 'Not saved' : 'All changes saved'}</span>
        <button className="btn-secondary btn-sm" onClick={() => openTab('ai')}><Bot size={15} /> <span className="hidden sm:inline">AI notes</span></button>
        <button className="btn-secondary btn-sm" onClick={() => openTab('people')}><Users size={15} /> <span className="hidden sm:inline">People</span>{isHost && cl.hostPeople.some((p) => p.status === 'pending') && <span className="h-2 w-2 rounded-full bg-amber-500" />}</button>
        {isHost && <button className="btn-secondary btn-sm" onClick={() => setPerms(true)}><ShieldCheck size={15} /> <span className="hidden lg:inline">Permissions</span></button>}
        {isHost && onDashboard && <button className="btn-ghost btn-sm" onClick={onDashboard} aria-label="Host dashboard"><LayoutDashboard size={16} /></button>}
        <button className="btn-ghost btn-sm" onClick={onLeave} aria-label="Leave classroom"><LogOut size={16} /></button>
        {!sideOpen && <button className="btn-ghost btn-sm" onClick={() => setSideOpen(true)} aria-label="Open side panel"><PanelRightOpen size={16} /></button>}
      </header>

      {cl.conn === 'reconnecting' && <div role="alert" className="flex items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-sm text-amber-900"><WifiOff size={14} /> Connection lost. Reconnecting, and your board will resync automatically.</div>}

      <div className="flex min-h-0 flex-1">
        <main ref={boardWrap} className="relative min-w-0 flex-1 border-r border-ink-100">
          <Board cl={cl} auth={auth} hist={hist} tool={tool} color={color} width={width} fill={fill} view={view} setView={setView} selectedId={selectedId} setSelectedId={setSelectedId} onDropFile={uploadImage} />

          <div className="absolute left-3 top-3 max-h-[calc(100%-24px)]">
            <Toolbar tool={tool} setTool={setTool} canDraw={canDraw} canUpload={!!eff?.upload} canClear={!!eff?.clear} canUndo={hist.canUndo} canRedo={hist.canRedo}
              onUndo={() => void hist.undo()} onRedo={() => void hist.redo()} onUpload={() => fileRef.current?.click()} onClear={() => setConfirmClear(true)} denied={denied} />
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }} />
          </div>

          {!canDraw && cl.conn === 'live' && (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-ink-100 bg-white px-3.5 py-1.5 text-sm shadow-card">
              {cl.settings?.locked ? <Lock size={14} className="text-ink-500" /> : null}
              <span className="text-ink-700">{cl.settings?.locked ? 'The host locked the board.' : 'View only.'}</span>
              {eff?.request && <button className="btn-primary btn-sm" disabled={requested} onClick={requestAccess}><Hand size={13} /> {requested ? 'Request sent' : 'Request access'}</button>}
            </div>
          )}

          {showOptions && (
            <div className="card absolute bottom-4 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 overflow-x-auto px-3 py-2">
              <div className="flex items-center gap-1.5" role="group" aria-label="Color">
                {COLORS.map((c) => <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c} className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-brand ring-2 ring-brand/30' : 'border-white ring-1 ring-ink-100'}`} style={{ background: c }} />)}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom color" className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0" />
              </div>
              <div className="h-6 w-px bg-ink-100" />
              {tool !== 'text' && tool !== 'sticky' && (
                <div className="flex items-center gap-1" role="group" aria-label="Thickness">
                  {WIDTHS.map((w) => <button key={w} onClick={() => setWidth(w)} aria-label={`Thickness ${w}`} aria-pressed={width === w} className={`flex h-8 w-8 items-center justify-center rounded-lg ${width === w ? 'bg-brand-soft' : 'hover:bg-ink-50'}`}><span className="rounded-full bg-ink" style={{ width: 4 + w, height: 4 + w }} /></button>)}
                </div>
              )}
              {(tool === 'rect' || tool === 'ellipse') && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} className="accent-[#4263EB]" /> Fill</label>}
            </div>
          )}

          <div className="card absolute bottom-4 right-3 flex items-center p-1" role="group" aria-label="Zoom">
            <button className="btn-ghost btn-sm !px-1.5" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Minus size={15} /></button>
            <button className="btn-ghost btn-sm w-12 !px-0 tabular-nums" onClick={() => setView({ ...view, k: 1 })} aria-label="Reset zoom">{Math.round(view.k * 100)}%</button>
            <button className="btn-ghost btn-sm !px-1.5" onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus size={15} /></button>
            <button className="btn-ghost btn-sm !px-1.5" onClick={fit} aria-label="Fit board to screen"><Maximize2 size={15} /></button>
          </div>
        </main>

        {sideOpen && (
          <aside className={`fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-white md:static md:z-auto md:shrink-0 ${wide && tab === 'ai' ? 'md:w-[min(760px,55vw)]' : 'md:w-[380px]'}`} aria-label="Side panel">
            <div className="flex items-center border-b border-ink-100 px-2" role="tablist">
              {([['chat', 'Chat', MessageSquare], ['people', 'People', Users], ['ai', 'AI notes', Bot]] as const).map(([id, label, Icon]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`relative flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-brand text-brand' : 'border-transparent text-ink-500 hover:text-ink'}`}>
                  <Icon size={15} /> {label}
                  {id === 'chat' && cl.unread > 0 && tab !== 'chat' && <span className="rounded-full bg-brand px-1.5 text-[10px] text-white">{cl.unread}</span>}
                </button>
              ))}
              <div className="flex-1" />
              <button className="btn-ghost btn-sm !px-1.5" onClick={() => setSideOpen(false)} aria-label="Collapse side panel"><ChevronsRight size={16} /></button>
            </div>
            <div className="min-h-0 flex-1" role="tabpanel">
              {tab === 'chat' && <ChatPanel cl={cl} />}
              {tab === 'people' && <ParticipantsPanel cl={cl} onOpenPermissions={() => setPerms(true)} requested={requested} onRequest={requestAccess} />}
              {tab === 'ai' && <AiNotesPanel cl={cl} auth={auth} expanded={wide} onExpand={() => setWide((w) => !w)} />}
            </div>
          </aside>
        )}
      </div>

      {perms && isHost && <PermissionsDialog cl={cl} onClose={() => setPerms(false)} />}
      {confirmClear && (
        <Modal title="Clear the whole board?" onClose={() => setConfirmClear(false)}>
          <p className="text-sm text-ink-700">This removes all {cl.objects.length} objects for everyone in the classroom. It cannot be undone.</p>
          <div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setConfirmClear(false)}>Keep board</button><button className="btn-danger" onClick={() => { void cl.clearBoard(); setConfirmClear(false); }}>Clear board</button></div>
        </Modal>
      )}
    </div>
  );
}
