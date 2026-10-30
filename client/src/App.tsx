import { useCallback, useState } from 'react';
import { Logo, Toasts } from './components/ui';
import { useClassroom } from './hooks/useClassroom';
import Classroom from './pages/Classroom';
import Dashboard from './pages/Dashboard';
import Welcome from './pages/Welcome';
import { activeAuth, saved } from './services/api';
import type { Auth } from './types';

function Session({ auth, onExit }: { auth: Auth; onExit: (notice?: string) => void }) {
  const cl = useClassroom(auth, (reason) => { if (auth.role === 'participant') saved.remove(auth.code); onExit(reason); });
  const [view, setView] = useState<'dashboard' | 'board'>(auth.role === 'host' ? 'dashboard' : 'board');

  let body;
  if (cl.pending) body = (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center"><Logo size={36} />
      <div className="card max-w-sm p-6"><h1 className="text-lg font-semibold">Waiting for the host</h1><p className="mt-1 text-sm text-ink-500">You’re in the waiting room for “{cl.classroom?.name}”. The whiteboard opens as soon as the host lets you in.</p>
        <button className="btn-secondary mt-4" onClick={() => onExit()}>Leave</button></div></div>
  );
  else if (!cl.me || !cl.settings) body = <div className="flex h-full items-center justify-center text-sm text-ink-500" role="status">{cl.closedReason ?? (cl.conn === 'reconnecting' ? 'Cannot reach the classroom server. Retrying…' : 'Connecting to the classroom…')}{cl.closedReason && <button className="btn-secondary ml-3" onClick={() => onExit()}>Back</button>}</div>;
  else if (cl.closedReason && auth.role !== 'host') body = (
    <div className="flex h-full items-center justify-center px-4"><div className="card max-w-sm p-6 text-center"><h1 className="text-lg font-semibold">Classroom closed</h1><p className="mt-1 text-sm text-ink-500">{cl.closedReason} Your saved work stays on the host’s computer; join again when it reopens.</p><button className="btn-primary mt-4" onClick={() => onExit()}>Back to start</button></div></div>
  );
  else if (view === 'dashboard' && auth.role === 'host') body = <Dashboard cl={cl} auth={auth} onOpen={() => setView('board')} onLeave={() => onExit()} />;
  else body = <Classroom cl={cl} auth={auth} onDashboard={auth.role === 'host' ? () => setView('dashboard') : undefined} onLeave={() => onExit()} />;
  return <>{body}<Toasts toasts={cl.toasts} dismiss={cl.dismissToast} /></>;
}

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(() => activeAuth.get());
  const [notice, setNotice] = useState<string | undefined>();
  const enter = useCallback((a: Auth) => { activeAuth.set(a); setNotice(undefined); setAuth(a); }, []);
  const exit = useCallback((n?: string) => { activeAuth.set(null); setNotice(n); setAuth(null); }, []);
  return auth ? <Session key={auth.token} auth={auth} onExit={exit} /> : <Welcome notice={notice} onAuth={enter} />;
}
