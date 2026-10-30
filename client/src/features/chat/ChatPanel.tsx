import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/ui';
import type { Classroom } from '../../hooks/useClassroom';

const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function ChatPanel({ cl }: { cl: Classroom }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const canChat = cl.me?.effective.chat ?? false;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [cl.chat.length]);

  const send = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    const ok = await cl.sendChat(t);
    if (ok) setText('');
    setSending(false);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Chat messages">
        {cl.chat.length === 0 && (
          <div className="mt-10 rounded-xl border border-dashed border-ink-200 p-5 text-center">
            <p className="text-sm font-medium">No messages yet</p>
            <p className="mt-1 text-xs text-ink-500">Ask a question or share a thought. Everyone in this classroom will see it.</p>
          </div>
        )}
        {cl.chat.map((m) => {
          if (m.kind === 'system') return <p key={m.id} className="text-center text-xs text-ink-500">{m.text}</p>;
          const mine = m.participantId === cl.me?.id;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar name={m.senderName} size={28} />
              <div className={`max-w-[78%] ${mine ? 'items-end text-right' : ''}`}>
                <div className="mb-0.5 text-[11px] text-ink-500">{mine ? 'You' : m.senderName} · {fmt(m.createdAt)}</div>
                <div className={`inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm ${mine ? 'rounded-tr-sm bg-brand text-white' : 'rounded-tl-sm bg-ink-50 text-ink'}`}>{m.text}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="border-t border-ink-100 p-3">
        {!canChat ? (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-center text-xs text-ink-500">Chat is turned off for you by the host.</p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1000} aria-label="Message"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={cl.conn === 'live' ? 'Message the classroom' : 'Reconnecting…'} disabled={cl.conn !== 'live'}
              className="input max-h-28 min-h-[38px] resize-none" />
            <button onClick={send} disabled={!text.trim() || sending || cl.conn !== 'live'} className="btn-primary !px-3" aria-label="Send message"><Send size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
