import { Lock, LockOpen } from 'lucide-react';
import { Avatar, Modal, RoleChip, Toggle } from '../../components/ui';
import type { Classroom } from '../../hooks/useClassroom';
import type { Settings } from '../../types';

const POLICIES: { id: Settings['drawPolicy']; title: string; text: string }[] = [
  { id: 'none', title: 'Nobody', text: 'Only you can draw.' },
  { id: 'selected', title: 'Selected people', text: 'Only editors you choose.' },
  { id: 'everyone', title: 'Everyone', text: 'All approved participants.' },
];

export default function PermissionsDialog({ cl, onClose }: { cl: Classroom; onClose: () => void }) {
  const s = cl.settings; if (!s) return null;
  const set = (patch: Partial<Settings>) => cl.hostAction('host:setSettings', { settings: patch });
  const members = cl.hostPeople.filter((p) => p.status === 'approved' && p.role !== 'host');
  const perm = (id: string, perms: object) => cl.hostAction('host:setParticipant', { participantId: id, perms });
  return (
    <Modal title="Permissions and session settings" onClose={onClose} wide>
      <section aria-labelledby="pol">
        <h3 id="pol" className="mb-2 text-sm font-semibold">Who can draw on the board</h3>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {POLICIES.map((o) => (
            <button key={o.id} role="radio" aria-checked={s.drawPolicy === o.id} onClick={() => set({ drawPolicy: o.id })}
              className={`rounded-xl border p-3 text-left transition-colors ${s.drawPolicy === o.id ? 'border-brand bg-brand-soft' : 'border-ink-100 hover:bg-ink-50'}`}>
              <span className="block text-sm font-semibold">{o.title}</span><span className="block text-xs text-ink-500">{o.text}</span>
            </button>
          ))}
        </div>
        <button className={`mt-3 ${s.locked ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set({ locked: !s.locked })}>
          {s.locked ? <><LockOpen size={16} /> Unlock board</> : <><Lock size={16} /> Lock board for everyone else</>}
        </button>
        {s.locked && <p className="mt-2 text-xs text-ink-500">The board is locked. Only you can edit it until you unlock it.</p>}
      </section>

      <section className="mt-6 divide-y divide-ink-100 border-t border-ink-100 pt-3" aria-label="Classroom options">
        <Toggle checked={s.requireApproval} onChange={(v) => set({ requireApproval: v })} label="Approve new participants" hint="New people wait until you let them in." />
        <Toggle checked={s.chatEnabled} onChange={(v) => set({ chatEnabled: v })} label="Group chat" hint="Turn off to silence chat for participants." />
        <Toggle checked={s.allowUploads} onChange={(v) => set({ allowUploads: v })} label="Image uploads by editors" />
        <Toggle checked={s.allowAI} onChange={(v) => set({ allowAI: v })} label="Participants can generate AI notes" hint="Uses the host's AI key. You can always generate notes." />
        <Toggle checked={s.chatToAI} onChange={(v) => set({ chatToAI: v })} label="Include chat in AI notes" hint="Off by default so private discussion is not sent to the AI provider." />
      </section>

      <section className="mt-6 border-t border-ink-100 pt-3" aria-label="Individual permissions">
        <h3 className="mb-2 text-sm font-semibold">Individual permissions</h3>
        {members.length === 0 ? <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-500">Nobody has joined yet. Share the classroom code to get started.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-ink-500"><th className="pb-2 font-medium">Participant</th>{['Draw', 'Images', 'Chat', 'AI notes', 'Can ask'].map((h) => <th key={h} className="pb-2 text-center font-medium">{h}</th>)}<th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {members.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2"><div className="flex items-center gap-2"><Avatar name={p.name} size={24} /><span className="max-w-[120px] truncate font-medium">{p.name}</span><RoleChip role="participant" canDraw={p.effective.draw} /></div></td>
                    {([['canDraw', 'Draw'], ['canUpload', 'Images'], ['canChat', 'Chat'], ['canAI', 'AI notes'], ['canRequest', 'Can ask']] as const).map(([k, l]) => (
                      <td key={k} className="text-center"><input type="checkbox" className="h-4 w-4 accent-[#4263EB]" aria-label={`${l} for ${p.name}`} checked={p.perms[k]} onChange={(e) => perm(p.id, { [k]: e.target.checked })} /></td>
                    ))}
                    <td className="text-right"><button className="btn-danger btn-sm" onClick={() => confirm(`Revoke ${p.name}'s access to this classroom?`) && cl.hostAction('host:decision', { participantId: p.id, action: 'remove' })}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-500">Changes apply immediately and are enforced by the server, not just in the participant’s interface.</p>
      </section>
    </Modal>
  );
}
