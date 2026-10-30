import { ArrowRight, Loader2, Wifi } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Logo } from '../components/ui';
import { api, ApiError, saved } from '../services/api';
import type { Auth } from '../types';

export default function Welcome({ notice, onAuth }: { notice?: string; onAuth: (a: Auth) => void }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<'join' | 'host'>('join');
  const [name, setName] = useState('');
  const [code, setCode] = useState((params.get('code') || '').toUpperCase());
  const [password, setPassword] = useState('');
  const [room, setRoom] = useState('');
  const [approval, setApproval] = useState(true);
  const [info, setInfo] = useState<{ exists: boolean; name?: string; requiresPassword?: boolean } | null>(null);
  const [err, setErr] = useState(notice ?? '');
  const [busy, setBusy] = useState(false);
  const savedList = saved.list();

  useEffect(() => {
    setInfo(null);
    if (mode !== 'join' || code.length !== 6) return;
    const t = setTimeout(() => api.publicInfo(code).then(setInfo).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [code, mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'host') {
        const r = await api.create({ name: room.trim(), hostName: name.trim(), password: password || undefined, requireApproval: approval });
        const a: Auth = { code: r.code, token: r.token, role: 'host', name: name.trim(), classroom: r.name }; saved.put(a); onAuth(a);
      } else {
        const r = await api.join(code.trim(), { name: name.trim(), password: password || undefined });
        onAuth({ code: r.code, token: r.token, role: 'participant', name: name.trim(), classroom: r.name });
      }
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-8"><Logo size={40} /></div>
      <div className="card w-full max-w-md p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">Draw, discuss and learn together</h1>
        <p className="mt-1 text-sm text-ink-500">A shared classroom whiteboard that runs on your own network, with live chat and AI-written study notes.</p>
        <div className="mt-5 grid grid-cols-2 rounded-lg bg-ink-50 p-1 text-sm font-medium" role="tablist">
          {(['join', 'host'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(''); }} className={`rounded-md py-2 ${mode === m ? 'bg-white shadow-sm' : 'text-ink-500'}`}>{m === 'join' ? 'Join classroom' : 'Host a classroom'}</button>)}
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div><label className="label" htmlFor="name">Your display name</label><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus placeholder="e.g. Asha" autoComplete="nickname" /></div>
          {mode === 'host' ? (
            <>
              <div><label className="label" htmlFor="room">Classroom name</label><input id="room" className="input" value={room} onChange={(e) => setRoom(e.target.value)} maxLength={80} required placeholder="e.g. Computer Networks, Unit 3" /></div>
              <div><label className="label" htmlFor="pw">Password <span className="font-normal text-ink-300">(optional)</span></label><input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} autoComplete="new-password" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} className="accent-[#4263EB]" /> I approve each person who joins</label>
            </>
          ) : (
            <>
              <div><label className="label" htmlFor="code">Classroom code</label><input id="code" className="input font-mono uppercase tracking-[0.25em]" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} required minLength={6} placeholder="ABC234" inputMode="text" autoCapitalize="characters" />
                {info?.exists && <p className="mt-1 text-xs text-green-700">Found “{info.name}”.</p>}
                {info && !info.exists && <p className="mt-1 text-xs text-red-600">No classroom with that code on this server.</p>}</div>
              {(info?.requiresPassword || password) && <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} /></div>}
            </>
          )}
          {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <button className="btn-primary w-full !py-2.5" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{mode === 'host' ? 'Create classroom' : 'Join classroom'} {!busy && <ArrowRight size={16} />}</button>
        </form>
        {mode === 'host' && savedList.length > 0 && (
          <div className="mt-5 border-t border-ink-100 pt-4"><p className="mb-2 text-sm font-medium">Your saved classrooms</p>
            <ul className="space-y-1.5">{savedList.filter((s) => s.role === 'host').map((s) => (
              <li key={s.code} className="flex items-center gap-2"><button className="flex-1 truncate rounded-lg border border-ink-100 px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => onAuth(s)}>{s.classroom} <span className="font-mono text-xs text-ink-500">{s.code}</span></button>
                <button className="text-xs text-ink-500 hover:text-red-600" onClick={() => { saved.remove(s.code); location.reload(); }}>Forget</button></li>))}</ul></div>
        )}
      </div>
      <p className="mt-5 flex items-center gap-1.5 text-xs text-ink-500"><Wifi size={13} /> Works on your local network. No internet needed for drawing and chat.</p>
    </div>
  );
}
