import { ArrowUpRight, Circle, Eraser, Hand, Highlighter, Image as ImageIcon, Minus, MousePointer2, PenLine, Redo2, Square, StickyNote, Trash2, Type, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Tool } from '../../types';

interface Props {
  tool: Tool; setTool: (t: Tool) => void; canDraw: boolean; canUpload: boolean; canClear: boolean;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onUpload: () => void; onClear: () => void; denied: () => void;
}
const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode; needsDraw: boolean }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: <MousePointer2 size={18} />, needsDraw: false },
  { id: 'pan', label: 'Pan', key: 'Space', icon: <Hand size={18} />, needsDraw: false },
  { id: 'pen', label: 'Pen', key: 'P', icon: <PenLine size={18} />, needsDraw: true },
  { id: 'highlighter', label: 'Highlighter', key: 'H', icon: <Highlighter size={18} />, needsDraw: true },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser size={18} />, needsDraw: true },
  { id: 'text', label: 'Text', key: 'T', icon: <Type size={18} />, needsDraw: true },
  { id: 'line', label: 'Line', key: 'L', icon: <Minus size={18} className="-rotate-45" />, needsDraw: true },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: <ArrowUpRight size={18} />, needsDraw: true },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={18} />, needsDraw: true },
  { id: 'ellipse', label: 'Circle / ellipse', key: 'O', icon: <Circle size={18} />, needsDraw: true },
  { id: 'sticky', label: 'Sticky note', key: 'N', icon: <StickyNote size={18} />, needsDraw: true },
];

function Btn({ label, hint, active, disabled, onClick, children, danger }: { label: string; hint?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} aria-disabled={disabled}
      className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${active ? 'bg-brand text-white shadow-sm' : disabled ? 'text-ink-200' : danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-700 hover:bg-ink-50'}`}>
      {children}
      <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white shadow-pop group-hover:block group-focus-visible:block">
        {label}{hint && <span className="ml-1.5 text-ink-300">{hint}</span>}
      </span>
    </button>
  );
}

export default function Toolbar(p: Props) {
  return (
    <nav aria-label="Drawing tools" className="card scroll-thin flex max-h-full flex-col items-center gap-0.5 overflow-y-auto p-1.5">
      {TOOLS.map((t) => (
        <Btn key={t.id} label={t.label} hint={t.key} active={p.tool === t.id} disabled={t.needsDraw && !p.canDraw} onClick={() => (t.needsDraw && !p.canDraw ? p.denied() : p.setTool(t.id))}>{t.icon}</Btn>
      ))}
      <Btn label="Upload image" disabled={!p.canUpload} onClick={() => (p.canUpload ? p.onUpload() : p.denied())}><ImageIcon size={18} /></Btn>
      <div className="my-1 h-px w-6 bg-ink-100" />
      <Btn label="Undo" hint="Ctrl+Z" disabled={!p.canDraw || !p.canUndo} onClick={p.onUndo}><Undo2 size={18} /></Btn>
      <Btn label="Redo" hint="Ctrl+Y" disabled={!p.canDraw || !p.canRedo} onClick={p.onRedo}><Redo2 size={18} /></Btn>
      {p.canClear && <Btn label="Clear board" danger onClick={p.onClear}><Trash2 size={18} /></Btn>}
    </nav>
  );
}
