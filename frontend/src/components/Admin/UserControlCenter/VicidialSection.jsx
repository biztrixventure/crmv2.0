// VicidialSection — the user's dialer agent ids (one per box). POST /vicidial/
// agents REPLACES the whole array, so add = re-post [...ids, new], remove =
// re-post ids-without-x. A 409 means the id already belongs to another user.
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState } from 'react';
import { Headphones, Plus, X } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { SectionHeader, Loading, useFlash, accent } from '../../UI/kit';

const norm = (s) => String(s || '').trim().toUpperCase();

export default function VicidialSection({ account, onChanged }) {
  const [ids, setIds]   = useState(() => (account.vicidial_agent_ids || []).map(norm).filter(Boolean));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { msg, flash, clear } = useFlash();

  // Persist the full list via the existing (clash-checked) endpoint.
  const persist = async (nextIds) => {
    setBusy(true);
    try {
      await client.post('vicidial/agents', { user_id: account.user_id, agent_id: nextIds.join(',') });
      setIds(nextIds);
      flash('success', 'Dialer ids saved.');
      onChanged?.();
    } catch (e) {
      flash('error', e.response?.status === 409
        ? (e.response?.data?.error || 'That id is already mapped to another user.')
        : (e.response?.data?.error || 'Save failed.'));
    } finally { setBusy(false); }
  };

  const add = () => {
    const parts = input.split(/[,\s]+/).map(norm).filter(Boolean);
    if (!parts.length) return;
    const next = [...new Set([...ids, ...parts])];
    setInput('');
    persist(next);
  };

  const remove = (id) => persist(ids.filter(x => x !== id));

  const a = accent('primary');

  return (
    <div className="max-w-xl">
      <SectionHeader
        icon={Headphones}
        title="VICIdial agent ids"
        subtitle="Dialer login/agent id(s). If this person works more than one box with different ids, add them all — dispositions from any of them map to this user."
      />
      {msg && <div className="mb-3"><Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert></div>}

      <div className="flex flex-wrap gap-2 mb-3 min-h-[36px]">
        {ids.length === 0 && <span className="text-sm text-text-secondary">No dialer id mapped.</span>}
        {ids.map(id => (
          <span key={id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: a.soft, color: a.fg, border: `1px solid ${a.soft}` }}>
            {id}
            <button onClick={() => remove(id)} disabled={busy} className="hover:opacity-70"><X size={14} /></button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="e.g. ETC0895, 2006" disabled={busy}
          className="input flex-1" />
        <button onClick={add} disabled={busy || !input.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
          {busy ? <Loading variant="inline" size={15} /> : <Plus size={15} />} Add
        </button>
      </div>
    </div>
  );
}
