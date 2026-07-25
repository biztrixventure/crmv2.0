// VicidialSection — the user's dialer agent ids (one per box). POST /vicidial/
// agents REPLACES the whole array, so add = re-post [...ids, new], remove =
// re-post ids-without-x. A 409 means the id already belongs to another user.
import { useState } from 'react';
import { Headphones, Plus, X, Loader2 } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';

const norm = (s) => String(s || '').trim().toUpperCase();

export default function VicidialSection({ account, onChanged }) {
  const [ids, setIds]   = useState(() => (account.vicidial_agent_ids || []).map(norm).filter(Boolean));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState(null);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); };

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

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-2 mb-1">
        <Headphones size={16} style={{ color: 'var(--color-primary-600)' }} />
        <h3 className="text-sm font-bold text-text">VICIdial agent ids</h3>
      </div>
      <p className="text-xs text-text-secondary mb-3">Dialer login/agent id(s). If this person works more than one box with different ids, add them all — dispositions from any of them map to this user.</p>
      {msg && <div className="mb-3"><Alert type={msg.type}>{msg.text}</Alert></div>}

      <div className="flex flex-wrap gap-2 mb-3 min-h-[36px]">
        {ids.length === 0 && <span className="text-sm text-text-secondary">No dialer id mapped.</span>}
        {ids.map(id => (
          <span key={id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: 'var(--color-primary-50, rgba(99,102,241,0.1))', color: 'var(--color-primary-600)', border: '1px solid var(--color-primary-400)' }}>
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
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
        </button>
      </div>
    </div>
  );
}
