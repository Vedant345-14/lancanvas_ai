import { Check, Copy, DoorClosed, DoorOpen, Play, Server, Users, Wifi } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Avatar, copyText, Logo } from '../components/ui';
import type { Classroom } from '../hooks/useClassroom';
import { api } from '../services/api';
import type { Auth, NetworkInfo } from '../types';

export default function Dashboard({ cl, auth, onOpen, onLeave }: { cl: Classroom; auth: Auth; onOpen: () => void; onLeave: () => void }) {
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [netErr, setNetErr] = useState('');
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.network(auth).then(setNet).catch((e) => setNetErr(e.message)); }, [auth.token]); // eslint-disable-line
  const addr = net?.addresses[sel];
  const link = addr ? `${addr.url}/?code=${auth.code}` : '';
  const pending = cl.hostPeople.filter((p) => p.status === 'pending');
  const members = cl.hostPeople.filter((p) => p.status === 'approved' && p.role !== 'host');
  const online = members.filter((p) => p.online).length;
  const closed = cl.conn === 'closed' || !!cl.closedReason;

  return (
    <div className="min-h-full bg-canvasbg">
      <header className="flex items-center justify-between border-b border-ink-100 bg-white px-6 py-3.5">
        <Logo />
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={onLeave}>Leave dashboard</button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 p-5 md:grid-cols-[1.35fr_1fr] md:p-8">
        <section className="card p-6 md:col-span-2">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{auth.classroom || cl.classroom?.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-500">
                <span className={`inline-flex items-center gap-1.5 ${cl.conn === 'live' ? 'text-green-700' : 'text-amber-700'}`}><Server size={14} /> Server {cl.conn === 'live' ? 'connected' : cl.conn}</span>
                <span className="inline-flex items-center gap-1.5"><Users size={14} /> {online} online · {members.length} joined</span>
              </p>
            </div>
            <div className="rounded-xl bg-ink px-5 py-3 text-center text-white"><div className="text-xs text-ink-300">Classroom code</div><div className="font-mono text-2xl font-semibold tracking-[0.2em]">{auth.code}</div></div>
            <button className="btn-primary !px-5 !py-3 text-base" onClick={onOpen}><Play size={18} /> Open whiteboard</button>
          </div>
          {closed && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">This classroom is closed. <button className="font-medium underline" onClick={async () => { await api.reopen(auth); window.location.reload(); }}>Reopen it</button></p>}
        </section>

        <section className="card p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Wifi size={17} /> Share with your class</h2>
          <p className="mb-4 text-sm text-ink-500">Everyone must be on the same Wi-Fi or Ethernet network as this computer. Open the link, then enter the classroom code{'.'}</p>
          {netErr && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{netErr}</p>}
          {net && net.addresses.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No network address found. Connect this computer to Wi-Fi or Ethernet, then reload. Clients on this same computer can use <code>http://localhost:{net.port}</code>.</p>}
          {net && net.bindHost !== '0.0.0.0' && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The server is bound to {net.bindHost}, so other devices cannot connect. Set HOST=0.0.0.0 in .env and restart.</p>}
          {addr && (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <div role="radiogroup" aria-label="Network address" className="space-y-1.5">
                  {net!.addresses.map((a, i) => (
                    <button key={a.address} role="radio" aria-checked={sel === i} onClick={() => setSel(i)} className={`w-full rounded-lg border p-2.5 text-left ${sel === i ? 'border-brand bg-brand-soft' : 'border-ink-100 hover:bg-ink-50'}`}>
                      <span className="block font-mono text-sm font-medium">{a.url}</span>
                      <span className="block text-xs text-ink-500">{a.iface} · {a.note}</span>
                    </button>
                  ))}
                </div>
                <button className="btn-secondary mt-3 w-full" onClick={async () => { await copyText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy connection link'}</button>
                {net!.addresses.length > 1 && <p className="mt-2 text-xs text-ink-500">Several adapters found. Pick the one on the same network as your class (usually your Wi-Fi). VM, VPN and Docker adapters rarely work.</p>}
              </div>
              <div className="flex flex-col items-center gap-1.5 self-start rounded-xl border border-ink-100 p-3"><QRCodeSVG value={link} size={132} level="M" /><span className="text-xs text-ink-500">Scan to join</span></div>
            </div>
          )}
        </section>

        <section className="card p-6">
          <h2 className="mb-3 text-base font-semibold">Waiting to join {pending.length > 0 && <span className="chip ml-1 bg-amber-50 text-amber-700">{pending.length}</span>}</h2>
          {pending.length === 0 ? <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-500">No requests right now. New participants appear here for approval.</p> : (
            <ul className="space-y-2">{pending.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-ink-100 p-2"><Avatar name={p.name} /><span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                <button className="btn-primary btn-sm" onClick={() => cl.hostAction('host:decision', { participantId: p.id, action: 'approve' })}>Approve</button>
                <button className="btn-danger btn-sm" onClick={() => cl.hostAction('host:decision', { participantId: p.id, action: 'reject' })}>Reject</button></li>
            ))}</ul>
          )}
          <h2 className="mb-2 mt-6 text-base font-semibold">Recent activity</h2>
          {cl.activity.length === 0 ? <p className="text-sm text-ink-500">Joins, leaves and access requests will show up here.</p> : (
            <ul className="space-y-1.5 text-sm">{cl.activity.slice(0, 8).map((a) => <li key={a.id} className="flex justify-between gap-3"><span>{a.text}</span><span className="shrink-0 text-xs text-ink-300">{new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></li>)}</ul>
          )}
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-3 p-5 md:col-span-2">
          <p className="text-sm text-ink-500">Closing the classroom disconnects everyone. The board and chat stay saved and you can reopen it later.</p>
          <button className="btn-danger" onClick={() => confirm('Close this classroom for everyone?') && cl.hostAction('host:closeSession', {})}><DoorClosed size={16} /> Close classroom</button>
        </section>
      </main>
    </div>
  );
}
