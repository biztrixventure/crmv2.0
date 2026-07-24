import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Search, Send, Loader2, Check, User, Users, Building2, UsersRound, Shuffle, ListOrdered, Copy as CopyIcon, Scissors } from 'lucide-react';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';

// ============================================================================
// CreateBatchModal — turn the selected pulled numbers into distribution
// batch(es) and hand them to users. Reuses the EXISTING distribution flow
// (POST /vicidial/stats/create-batch → distribution_batches) so the numbers show
// up in each recipient's floating "My Numbers" widget. Four targets:
//   user      → one recipient gets everything
//   users     → several recipients (split among / copy to each)
//   team      → all members of a team (split / copy)
//   company   → all active users of a company (split / copy)
// distribute: 'split' divides the numbers; 'copy' gives every recipient all.
// ============================================================================

const digits = (s) => String(s || '').replace(/\D/g, '');

export default function CreateBatchModal({ numbers, defaultName, onClose, onSent }) {
  const [name, setName]   = useState(defaultName || 'Agent numbers');
  const [target, setTarget] = useState('user');           // user | users | team | company
  const [distribute, setDistribute] = useState('split');  // split | copy
  const [mode, setMode]   = useState('sequential');        // sequential | random

  // recipient pickers
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState([]);   // [{id,name,role,company_name}]
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const [result, setResult] = useState(null);

  // distinct phones actually sendable
  const distinct = useMemo(() => new Set((numbers || []).map(n => digits(n.phone).slice(-10)).filter(Boolean)).size, [numbers]);

  // recipient search (user / users targets)
  useEffect(() => {
    if (target !== 'user' && target !== 'users') return;
    let live = true;
    const t = setTimeout(async () => {
      try { const r = await client.get('distribution-batches/recipients', { params: { q } }); if (live) setFound(r.data.users || []); }
      catch { if (live) setFound([]); }
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q, target]);

  // companies (team / company targets)
  useEffect(() => {
    if (target !== 'team' && target !== 'company') return;
    if (companies.length) return;
    client.get('companies').then(r => setCompanies(r.data.companies || r.data || [])).catch(() => setCompanies([]));
  }, [target]);   // eslint-disable-line

  // teams for the chosen company (team target)
  useEffect(() => {
    if (target !== 'team' || !companyId) { setTeams([]); setTeamId(''); return; }
    client.get('teams', { params: { company_id: companyId } }).then(r => setTeams(r.data.teams || [])).catch(() => setTeams([]));
  }, [companyId, target]);

  const addPick = (u) => setPicked(prev => (prev.some(p => p.id === u.id) ? prev : (target === 'user' ? [u] : [...prev, u])));
  const removePick = (id) => setPicked(prev => prev.filter(p => p.id !== id));

  const multiRecipients = target === 'users' || target === 'team' || target === 'company';

  const canSend = useMemo(() => {
    if (!distinct) return false;
    if (target === 'user') return picked.length === 1;
    if (target === 'users') return picked.length >= 1;
    if (target === 'team') return !!teamId;
    if (target === 'company') return !!companyId;
    return false;
  }, [target, picked, teamId, companyId, distinct]);

  const submit = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const payload = {
        name: name.trim() || 'Agent numbers',
        numbers: (numbers || []).map(n => ({ phone: n.phone, customer_name: n.customer_name || null, lead_id: n.lead || null })),
        distribute, mode, target,
      };
      if (target === 'user') payload.recipient_id = picked[0]?.id;
      else if (target === 'users') payload.recipient_ids = picked.map(p => p.id);
      else if (target === 'team') payload.team_id = teamId;
      else if (target === 'company') payload.company_id = companyId;
      const r = await client.post('vicidial/stats/create-batch', payload);
      setResult(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Failed to create batch');
    } finally { setBusy(false); }
  }, [name, numbers, distribute, mode, target, picked, teamId, companyId]);

  const C = { border: 'var(--color-border)', sub: 'var(--color-text-muted,#64748b)' };
  const TARGETS = [
    { id: 'user',    label: 'One user',   Icon: User },
    { id: 'users',   label: 'Many users', Icon: Users },
    { id: 'team',    label: 'Team',       Icon: UsersRound },
    { id: 'company', label: 'Company',    Icon: Building2 },
  ];

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="rounded-2xl w-full animate-scale-in" style={{ maxWidth: 560, background: 'var(--color-surface,#fff)', border: `1px solid ${C.border}`, boxShadow: 'var(--shadow-xl)', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
          <h3 className="font-bold text-text inline-flex items-center gap-2"><Send size={16} /> Create batch → send</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {result ? (
          <div className="p-5 text-center">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: 'var(--color-success-50,#ecfdf5)' }}>
              <Check size={24} color="#059669" />
            </div>
            <p className="font-bold text-text mb-1">Sent · {result.batches?.length || 0} batch{(result.batches?.length || 0) === 1 ? '' : 'es'}</p>
            <p className="text-sm mb-3" style={{ color: C.sub }}>
              {result.total} numbers · {result.distribute === 'copy' ? 'copied to each recipient' : `split (${result.mode})`}
              {(result.batches || []).some(b => b.excluded_count) ? ` · ${(result.batches).reduce((a, b) => a + (b.excluded_count || 0), 0)} rule-excluded` : ''}
            </p>
            <button onClick={() => { onSent?.(); }} className="btn-primary text-sm">Done</button>
          </div>
        ) : (
          <div className="p-4">
            <p className="text-sm mb-3" style={{ color: C.sub }}>
              <b className="text-text">{distinct}</b> distinct number{distinct === 1 ? '' : 's'} ready to send.
            </p>

            {/* name */}
            <label className="block text-xs font-semibold mb-1 text-text">Batch name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full mb-3 px-3 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: `1px solid ${C.border}` }} />

            {/* target */}
            <label className="block text-xs font-semibold mb-1 text-text">Send to</label>
            <div className="grid grid-cols-4 gap-1.5 mb-3">
              {TARGETS.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => { setTarget(id); setPicked([]); setResult(null); }}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                  style={target === id ? { background: 'var(--color-primary-600,#4f46e5)', color: '#fff' } : { border: `1px solid ${C.border}`, color: C.sub }}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>

            {/* recipient picker */}
            {(target === 'user' || target === 'users') && (
              <div className="mb-3">
                {picked.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {picked.map(p => (
                      <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold" style={{ background: 'var(--color-primary-50,#eef2ff)', color: 'var(--color-primary-700,#4338ca)' }}>
                        {p.name}{p.role ? ` · ${p.role}` : ''}
                        <button onClick={() => removePick(p.id)}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.sub }} />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search users by name…" className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: `1px solid ${C.border}` }} />
                </div>
                {found.length > 0 && (
                  <div style={{ maxHeight: 180, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, marginTop: 6 }}>
                    {found.map(u => {
                      const on = picked.some(p => p.id === u.id);
                      return (
                        <button key={u.id} onClick={() => (on ? removePick(u.id) : addPick(u))} className="flex items-center gap-2 w-full text-left px-3 py-2" style={{ borderTop: `1px solid ${C.border}`, background: on ? 'var(--color-primary-50,#eef2ff)' : 'transparent' }}>
                          <span className="text-sm font-semibold text-text flex-1">{u.name}</span>
                          <span className="text-xs" style={{ color: C.sub }}>{u.role || ''}{u.company_name ? ` · ${u.company_name}` : ''}</span>
                          {on && <Check size={14} color="#4f46e5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {(target === 'team' || target === 'company') && (
              <div className="mb-3 space-y-2">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-text">Company</label>
                  <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)}>
                    <option value="">Pick a company…</option>
                    {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                  </ThemedSelect>
                </div>
                {target === 'team' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-text">Team</label>
                    <ThemedSelect value={teamId} onChange={e => setTeamId(e.target.value)} disabled={!companyId}>
                      <option value="">{companyId ? 'Pick a team…' : 'Pick a company first'}</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}{t.member_count != null ? ` (${t.member_count})` : ''}</option>)}
                    </ThemedSelect>
                  </div>
                )}
                <p className="text-xs" style={{ color: C.sub }}>
                  {target === 'company' ? 'Every active user of the company' : 'Every member of the team'} becomes a recipient.
                </p>
              </div>
            )}

            {/* distribute + mode (multi-recipient only) */}
            {multiRecipients && (
              <div className="mb-3">
                <label className="block text-xs font-semibold mb-1 text-text">How to distribute</label>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  <button onClick={() => setDistribute('split')} className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold" style={distribute === 'split' ? { background: 'var(--color-primary-600,#4f46e5)', color: '#fff' } : { border: `1px solid ${C.border}`, color: C.sub }}>
                    <Scissors size={14} /> Split among
                  </button>
                  <button onClick={() => setDistribute('copy')} className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold" style={distribute === 'copy' ? { background: 'var(--color-primary-600,#4f46e5)', color: '#fff' } : { border: `1px solid ${C.border}`, color: C.sub }}>
                    <CopyIcon size={14} /> Copy to each
                  </button>
                </div>
                {distribute === 'split' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => setMode('sequential')} className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold" style={mode === 'sequential' ? { background: 'var(--color-bg-subtle,#eef2ff)', color: 'var(--color-primary-700,#4338ca)' } : { border: `1px solid ${C.border}`, color: C.sub }}>
                      <ListOrdered size={13} /> Sequential
                    </button>
                    <button onClick={() => setMode('random')} className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold" style={mode === 'random' ? { background: 'var(--color-bg-subtle,#eef2ff)', color: 'var(--color-primary-700,#4338ca)' } : { border: `1px solid ${C.border}`, color: C.sub }}>
                      <Shuffle size={13} /> Random
                    </button>
                  </div>
                )}
              </div>
            )}

            {err && <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-danger-600,#dc2626)' }}>{err}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              <button onClick={submit} disabled={!canSend || busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send {distinct || ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
