import { Check, Hand, Settings2, UserX, X } from 'lucide-react';
import { Avatar, RoleChip } from '../../components/ui';
import type { Classroom } from '../../hooks/useClassroom';

export default function ParticipantsPanel({ cl, onOpenPermissions, requested, onRequest }: { cl: Classroom; onOpenPermissions: () => void; requested: boolean; onRequest: () => void }) {
  const isHost = cl.me?.role === 'host';
  const pending = cl.hostPeople.filter((p) => p.status === 'pending');
  const members = cl.hostPeople.filter((p) => p.status === 'approved');
  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-3">
      {isHost ? (
        <>
          <button className="btn-secondary mb-4 w-full" onClick={onOpenPermissions}><Settings2 size={16} /> Permissions and session settings</button>
          {pending.length > 0 && (
            <section className="mb-4" aria-label="Pending join requests">
              <h3 className="mb-2 text-sm font-semibold">Waiting to join ({pending.length})</h3>
              <ul className="space-y-2">
                {pending.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <Avatar name={p.name} /> <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <button className="btn-primary btn-sm" onClick={() => cl.hostAction('host:decision', { participantId: p.id, action: 'approve' })}><Check size={14} /> Approve</button>
                    <button className="btn-danger btn-sm !px-1.5" aria-label={`Reject ${p.name}`} onClick={() => cl.hostAction('host:decision', { participantId: p.id, action: 'reject' })}><X size={14} /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <h3 className="mb-2 text-sm font-semibold">In this classroom ({members.length})</h3>
          <ul className="space-y-1.5">
            {members.map((p) => (
              <li key={p.id} className="rounded-lg border border-ink-100 p-2">
                <div className="flex items-center gap-2">
                  <span className="relative"><Avatar name={p.name} /><span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${p.online ? 'bg-green-500' : 'bg-ink-200'}`} title={p.online ? 'Online' : 'Offline'} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  {p.requested && <span className="chip bg-amber-50 text-amber-700" title="Asked for drawing access"><Hand size={11} /> Asked</span>}
                  <RoleChip role={p.role} canDraw={p.effective.draw} />
                </div>
                {p.role !== 'host' && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="inline-flex rounded-lg bg-ink-50 p-0.5 text-xs font-medium" role="group" aria-label={`Access level for ${p.name}`}>
                      <button className={`rounded-md px-2.5 py-1 ${!p.perms.canDraw ? 'bg-white shadow-sm' : 'text-ink-500'}`} onClick={() => cl.hostAction('host:setParticipant', { participantId: p.id, perms: { canDraw: false } })}>Viewer</button>
                      <button className={`rounded-md px-2.5 py-1 ${p.perms.canDraw ? 'bg-white shadow-sm' : 'text-ink-500'}`} onClick={() => cl.hostAction('host:setParticipant', { participantId: p.id, perms: { canDraw: true } })}>Editor</button>
                    </div>
                    <div className="flex-1" />
                    <button className="btn-ghost btn-sm text-red-600" onClick={() => confirm(`Remove ${p.name} from the classroom?`) && cl.hostAction('host:decision', { participantId: p.id, action: 'remove' })}><UserX size={14} /> Remove</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {cl.settings?.drawPolicy !== 'selected' && <p className="mt-3 rounded-lg bg-ink-50 p-2.5 text-xs text-ink-500">Drawing policy is “{cl.settings?.drawPolicy === 'everyone' ? 'everyone can draw' : 'nobody can draw'}”, so the Viewer/Editor choice only applies when the policy is “selected participants”.</p>}
        </>
      ) : (
        <>
          <h3 className="mb-2 text-sm font-semibold">In this classroom ({cl.people.length})</h3>
          <ul className="space-y-1.5">
            {cl.people.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-ink-100 p-2">
                <span className="relative"><Avatar name={p.name} /><span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${p.online ? 'bg-green-500' : 'bg-ink-200'}`} /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}{p.id === cl.me?.id && <span className="text-ink-500"> (you)</span>}</span>
                <RoleChip role={p.role} canDraw={p.canDraw} />
              </li>
            ))}
          </ul>
          {cl.me?.effective.request && (
            <button className="btn-secondary mt-4 w-full" disabled={requested} onClick={onRequest}><Hand size={16} /> {requested ? 'Request sent' : 'Request drawing access'}</button>
          )}
        </>
      )}
    </div>
  );
}
