import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import type { Toast } from '../types';

export function Logo({ size = 28, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill={dark ? '#FFFFFF' : '#17233C'} />
        <path d="M18 18L46 18M18 18L32 46M46 18L32 46" stroke={dark ? '#17233C' : '#fff'} strokeWidth="3" strokeLinecap="round" opacity=".6" />
        <circle cx="18" cy="18" r="6" fill="#14B8A6" /><circle cx="46" cy="18" r="6" fill="#4263EB" /><circle cx="32" cy="46" r="6" fill={dark ? '#17233C' : '#fff'} />
      </svg>
      <span className={`font-semibold tracking-tight ${dark ? 'text-white' : 'text-ink'}`} style={{ fontSize: size * 0.62 }}>LanCanvas <span className="text-brand">AI</span></span>
    </div>
  );
}

export function Avatar({ name, size = 28, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const hues = [222, 168, 280, 24, 340, 190, 100, 48];
  const h = hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return (
    <span title={name} aria-label={name} className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${ring ? 'ring-2 ring-white' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${h} 55% 45%)` }}>
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 px-3" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg bg-ink px-3.5 py-2.5 text-sm text-white shadow-pop">
          {t.kind === 'error' ? <AlertTriangle size={16} className="shrink-0 text-amber-300" /> : t.kind === 'success' ? <CheckCircle2 size={16} className="shrink-0 text-teal" /> : <Info size={16} className="shrink-0 text-ink-200" />}
          <span>{t.text}</span>
          <button className="ml-1 text-ink-300 hover:text-white" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card flex max-h-[90vh] w-full flex-col overflow-hidden ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="btn-ghost btn-sm !px-1.5" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="scroll-thin overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-ink-500">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-ink-200'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function RoleChip({ role, canDraw, pending }: { role: string; canDraw?: boolean; pending?: boolean }) {
  if (pending) return <span className="chip bg-amber-50 text-amber-700">Pending</span>;
  if (role === 'host') return <span className="chip bg-brand-soft text-brand">Host</span>;
  return canDraw ? <span className="chip bg-teal-soft text-teal-700 text-[#0F766E]">Editor</span> : <span className="chip bg-ink-50 text-ink-500">Viewer</span>;
}

export const copyText = async (text: string): Promise<boolean> => {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
};
export const download = (name: string, data: Blob | string, type = 'text/plain') => {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};
