import { Copy, Download, FileDown, FileText, Image as ImageIcon, Layers, Loader2, Pencil, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText, download } from '../../components/ui';
import type { Classroom } from '../../hooks/useClassroom';
import { api, ApiError } from '../../services/api';
import type { Auth, NotesResult } from '../../types';
import { renderSnapshot } from '../whiteboard/render';
import { headings, mdToHtml, notesToMarkdown, printableHtml } from './notes';

type Mode = 'notes' | 'short' | 'flashcards';
const STAGES = ['Capturing the board…', 'Sending board text and image to the AI…', 'Writing your notes…'];

export default function AiNotesPanel({ cl, auth, onExpand, expanded }: { cl: Classroom; auth: Auth; onExpand: () => void; expanded: boolean }) {
  const allowed = cl.me?.effective.ai ?? false;
  const isHost = cl.me?.role === 'host';
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [result, setResult] = useState<NotesResult | null>(null);
  const [md, setMd] = useState('');
  const [snap, setSnap] = useState<{ png: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [err, setErr] = useState<{ msg: string; code?: string } | null>(null);
  const lastMode = useRef<Mode>('notes');
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.health().then((h) => setConfigured(h.aiConfigured)).catch(() => setConfigured(null)); }, []);
  useEffect(() => {
    if (!allowed) return;
    api.latestNotes(auth).then((r) => { if (r.latest && !result) { setResult(r.latest as NotesResult); setMd(notesToMarkdown(r.latest.notes, 'board.png')); } setConfigured(r.configured); }).catch(() => {});
  }, [allowed, auth.token]); // eslint-disable-line

  const boardImage = async (): Promise<{ jpeg?: string; png?: string }> => {
    const c = await renderSnapshot(cl.objects, (s) => api.fileUrl(auth, s), { maxDim: 1800 });
    if (!c) return {};
    return { jpeg: c.toDataURL('image/jpeg', 0.85), png: c.toDataURL('image/png') };
  };

  const generate = async (mode: Mode) => {
    lastMode.current = mode; setBusy(true); setErr(null); setStage(0);
    try {
      const img = await boardImage();
      if (img.png) setSnap({ png: img.png });
      setStage(1);
      const t = setTimeout(() => setStage(2), 3500);
      let r: NotesResult;
      try { r = await api.generateNotes(auth, mode, img.jpeg); } finally { clearTimeout(t); }
      setResult(r); setMd(notesToMarkdown(r.notes, 'board.png')); setEditing(false);
    } catch (e) {
      const ae = e as ApiError; setErr({ msg: ae.message, code: ae.code });
      if (ae.code === 'AI_NOT_CONFIGURED') setConfigured(false);
    } finally { setBusy(false); }
  };

  const toc = useMemo(() => headings(md), [md]);
  const html = useMemo(() => mdToHtml(md, snap?.png), [md, snap]);

  const savePdf = () => {
    const w = window.open('', '_blank');
    if (!w) return cl.toast('Pop-up blocked. Allow pop-ups, or use the HTML download and print it.', 'error');
    w.document.write(printableHtml(result?.notes.title ?? 'Notes', md, snap?.png)); w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  };
  const dlBoardPng = async () => {
    const png = snap?.png ?? (await boardImage()).png;
    if (!png) return cl.toast('The board is empty.', 'error');
    download('whiteboard.png', await (await fetch(png)).blob());
  };

  if (!allowed) return <div className="p-5"><div className="rounded-xl border border-dashed border-ink-200 p-5 text-center"><Sparkles className="mx-auto mb-2 text-ink-300" /><p className="text-sm font-medium">AI notes are off for you</p><p className="mt-1 text-xs text-ink-500">Ask the host to allow AI notes in Permissions.</p></div></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-ink-100 p-3">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy || configured === false} onClick={() => generate('notes')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {result ? 'Regenerate notes' : 'Generate AI notes'}</button>
          <button className="btn-secondary" disabled={busy || configured === false} onClick={() => generate('short')}><FileText size={16} /> Short summary</button>
          <button className="btn-secondary" disabled={busy || configured === false} onClick={() => generate('flashcards')}><Layers size={16} /> Flashcards</button>
        </div>
        {busy && <div role="status" className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand"><Loader2 size={14} className="animate-spin" /> {STAGES[stage]}</div>}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {configured === false && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-amber-900">AI is not set up on this server</p>
            <p className="mt-1 text-amber-800">The whiteboard works fine without it. To enable notes{isHost ? '' : ', ask the host to'} add these lines to the <code className="rounded bg-white px-1">.env</code> file next to <code className="rounded bg-white px-1">package.json</code> and restart the server:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-2 text-xs">{`AI_API_KEY=your-key\nAI_BASE_URL=https://api.openai.com/v1\nAI_MODEL=gpt-4o-mini`}</pre>
          </div>
        )}
        {err && err.code !== 'AI_NOT_CONFIGURED' && (
          <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><TriangleAlert size={16} className="mt-0.5 shrink-0" /><div><p className="font-medium">Could not generate notes</p><p>{err.msg}</p></div></div>
        )}
        {!result && !busy && !err && configured !== false && (
          <div className="rounded-xl border border-dashed border-ink-200 p-5 text-center"><Sparkles className="mx-auto mb-2 text-brand" /><p className="text-sm font-medium">Turn this board into study notes</p><p className="mt-1 text-xs text-ink-500">The AI reads the text, shapes and a picture of the board{cl.settings?.chatToAI ? ', plus the chat' : ''}. Nothing is sent until you press the button.</p></div>
        )}
        {result && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="chip bg-ink-50 text-ink-700">{result.mode === 'notes' ? 'Full notes' : result.mode === 'short' ? 'Short summary' : 'Flashcards'}</span>
              <span className={`chip ${result.visionUsed ? 'bg-teal-soft text-[#0F766E]' : 'bg-amber-50 text-amber-700'}`}>{result.visionUsed ? 'Diagram image analysed' : 'Text and structure only'}</span>
              <span className="text-ink-500">{new Date(result.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button className="btn-secondary btn-sm" onClick={() => setEditing((e) => !e)}><Pencil size={13} /> {editing ? 'Done editing' : 'Edit'}</button>
              <button className="btn-secondary btn-sm" onClick={async () => cl.toast((await copyText(md)) ? 'Notes copied.' : 'Copy failed.', 'info')}><Copy size={13} /> Copy</button>
              <button className="btn-secondary btn-sm" onClick={() => download('lancanvas-notes.md', md, 'text/markdown')}><Download size={13} /> Markdown</button>
              <button className="btn-secondary btn-sm" onClick={() => download('lancanvas-notes.html', printableHtml(result.notes.title, md, snap?.png), 'text/html')}><FileDown size={13} /> HTML</button>
              <button className="btn-secondary btn-sm" onClick={savePdf}><FileDown size={13} /> PDF</button>
              <button className="btn-secondary btn-sm" onClick={dlBoardPng}><ImageIcon size={13} /> Board PNG</button>
              <button className="btn-secondary btn-sm" onClick={async () => download('whiteboard.json', await api.exportJson(auth))}><Download size={13} /> Board JSON</button>
              <button className="btn-ghost btn-sm" disabled={busy || configured === false} onClick={() => generate(lastMode.current)}><RefreshCw size={13} /> Regenerate</button>
              <button className="btn-ghost btn-sm hidden md:inline-flex" onClick={onExpand}>{expanded ? 'Narrow view' : 'Wide view'}</button>
            </div>
            {toc.length > 0 && !editing && (
              <nav aria-label="Notes sections" className="mb-4 rounded-lg bg-ink-50 p-3"><p className="mb-1 text-xs font-semibold text-ink-500">Sections</p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{toc.filter((h) => h.level === 2).map((h) => <li key={h.id}><button className="text-brand hover:underline" onClick={() => docRef.current?.querySelector(`#${CSS.escape(h.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{h.text}</button></li>)}</ul>
              </nav>
            )}
            {editing ? (
              <textarea value={md} onChange={(e) => setMd(e.target.value)} aria-label="Edit notes (Markdown)" className="input h-[60vh] font-mono text-xs leading-relaxed" />
            ) : (
              <div ref={docRef} className="print-area prose-notes text-sm leading-relaxed [&_em]:text-ink-500 [&_figcaption]:text-xs [&_figcaption]:text-ink-500 [&_figure]:my-3 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:border-ink-100 [&_h2]:pb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_img]:w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-ink-100 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: html }} />
            )}
            <p className="mt-4 text-xs text-ink-500">AI-written notes can contain mistakes. Check them against the board before sharing.</p>
          </>
        )}
      </div>
    </div>
  );
}
