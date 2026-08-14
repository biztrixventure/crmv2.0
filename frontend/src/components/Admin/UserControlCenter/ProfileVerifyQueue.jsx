// ProfileVerifyQueue — the standalone control surface for profile verification.
//
// Shown on the User Control Center landing page (before a user is picked),
// because everything here is estate-wide: asking all staff, stopping all staff,
// and approving what came back. Doing that from inside a single user's record
// meant picking an unrelated person first just to reach a global button, and
// gave no way to approve more than one submission at a time.
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState, useEffect, useCallback } from 'react';
import { BellRing, BellOff, Check, X, ArrowRight, Users, RefreshCw, Inbox, CheckCheck } from 'lucide-react';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, useFlash } from '../../UI/kit';
import { Alert } from '../../../components/UI';

const fmt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const idList = (a) => (a && a.length ? a.join(', ') : 'not set');

// Which side of the business a role sits on, so the queue can be filtered.
const SIDE = { fronter: 'fronter', fronter_manager: 'fronter', closer: 'staff', closer_manager: 'staff' };

export default function ProfileVerifyQueue() {
  const [rows, setRows]       = useState(null);
  const [sel, setSel]         = useState(() => new Set());
  const [busy, setBusy]       = useState(false);
  const [filter, setFilter]   = useState('all');       // all | fronter | staff
  const [askName, setAskName] = useState(false);       // include name in the request
  const { msg, flash, clear } = useFlash();

  const load = useCallback(() => {
    client.get('users/profile-verification/pending')
      .then(r => { setRows(r.data.pending || []); setSel(new Set()); })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, okMsg) => {
    setBusy(true); clear();
    try { const r = await fn(); flash('success', typeof okMsg === 'function' ? okMsg(r) : okMsg); load(); }
    catch (e) { flash('error', e.response?.data?.error || 'Action failed.'); }
    finally { setBusy(false); }
  };

  const fields = askName ? ['vicidial_agent_id', 'name'] : ['vicidial_agent_id'];

  const askAll = () => {
    if (!window.confirm(`Ask EVERY active staff member to confirm their ${askName ? 'name and dialer ID' : 'dialer ID'}? They see it on their next page load.`)) return;
    act(() => client.post('users/profile-verification', { all: true, action: 'request', fields }),
        r => `All staff will be asked (${r.data.affected} user${r.data.affected === 1 ? '' : 's'}).`);
  };
  const stopAll = () => {
    if (!window.confirm('Stop asking EVERY user? Any prompt still on screen disappears; submissions already waiting stay in this queue.')) return;
    act(() => client.post('users/profile-verification', { all: true, action: 'cancel' }),
        r => `Stopped asking ${r.data.affected} user${r.data.affected === 1 ? '' : 's'}.`);
  };

  const reviewSelected = (action) => {
    const ids = [...sel];
    if (!ids.length) return;
    act(() => client.post('users/profile-verification/review-bulk', { user_ids: ids, action }),
        r => {
          const d = r.data;
          const n = action === 'approve' ? d.approved : d.rejected;
          return d.failed?.length
            ? `${n} done, ${d.failed.length} could not be applied — see the rows still listed.`
            : `${n} submission${n === 1 ? '' : 's'} ${action === 'approve' ? 'approved and applied' : 'rejected'}.`;
        });
  };
  const reviewOne = (uid, action) =>
    act(() => client.post(`users/${uid}/profile-verification/review`, { action }),
        action === 'approve' ? 'Approved and applied.' : 'Rejected — the user can submit again.');

  if (!rows) return <Loading />;

  const shown = rows.filter(r => filter === 'all' || SIDE[r.role] === filter);
  const allShownSelected = shown.length > 0 && shown.every(r => sel.has(r.user_id));
  const toggleAll = () => {
    const next = new Set(sel);
    if (allShownSelected) shown.forEach(r => next.delete(r.user_id));
    else shown.forEach(r => next.add(r.user_id));
    setSel(next);
  };
  const toggle = (uid) => {
    const next = new Set(sel);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    setSel(next);
  };

  const pill = (val, label, n) => (
    <button key={val} onClick={() => setFilter(val)}
      className="text-xs font-bold px-3 py-1.5 rounded-full"
      style={filter === val
        ? { background: 'var(--gradient-sidebar)', color: '#fff' }
        : { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
      {label}{typeof n === 'number' ? ` (${n})` : ''}
    </button>
  );

  return (
    <Panel pad="lg" className="mb-4">
      <SectionHeader icon={BellRing} title="Profile verification"
        subtitle="Ask staff to confirm their own details, then approve what they send back. Nothing changes on a profile until you approve it." />

      {msg && <Alert type={msg.type} message={msg.text} dismissible onDismiss={clear} />}

      {/* ── Send / withdraw, estate-wide ─────────────────────────────────── */}
      <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <label className="flex items-center gap-2 mb-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={askName} onChange={e => setAskName(e.target.checked)} />
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
            Also ask them to confirm their <strong>name</strong>
            <span style={{ color: 'var(--color-text-tertiary)' }}> — the dialer ID is always included</span>
          </span>
        </label>
        <div className="flex gap-2 flex-wrap">
          <button onClick={askAll} disabled={busy}
            className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Users size={13} /> Ask all staff
          </button>
          <button onClick={stopAll} disabled={busy}
            className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
            style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <BellOff size={13} /> Stop asking all staff
          </button>
          <button onClick={load} disabled={busy}
            className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
            style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          To ask (or stop asking) one person, open that user and use the VICIdial tab.
        </p>
      </div>

      {/* ── The approval queue ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <Inbox size={14} /> Waiting for approval
        </span>
        {pill('all', 'All', rows.length)}
        {pill('fronter', 'Fronter side', rows.filter(r => SIDE[r.role] === 'fronter').length)}
        {pill('staff', 'Closer / staff', rows.filter(r => SIDE[r.role] === 'staff').length)}
      </div>

      {!shown.length ? (
        <EmptyState icon={CheckCheck} title="Nothing waiting"
          hint="Submissions appear here as soon as staff answer the prompt." />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={allShownSelected} onChange={toggleAll} />
              Select all shown
            </label>
            {sel.size > 0 && (
              <>
                <button onClick={() => reviewSelected('approve')} disabled={busy}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5 disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-success-600)' }}>
                  <Check size={13} /> Approve {sel.size} selected
                </button>
                <button onClick={() => reviewSelected('reject')} disabled={busy}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
                  style={{ color: 'var(--color-danger-700, #b91c1c)', backgroundColor: 'var(--color-danger-50, #fef2f2)', border: '1px solid var(--color-danger-200, #fecaca)' }}>
                  <X size={13} /> Reject {sel.size}
                </button>
              </>
            )}
          </div>

          <div className="space-y-2">
            {shown.map(r => {
              const nameChanged = r.submitted_first_name || r.submitted_last_name;
              return (
                <div key={r.user_id} className="rounded-xl p-3 flex items-start gap-3"
                     style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <input type="checkbox" className="mt-1" checked={sel.has(r.user_id)} onChange={() => toggle(r.user_id)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      {r.name}
                      <span className="text-[11px] font-normal ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
                        {r.role || '—'}{r.company ? ` · ${r.company}` : ''} · {fmt(r.submitted_at)}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 flex-wrap text-xs font-mono mt-1.5">
                      <span className="px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                        {idList(r.previous_ids)}
                      </span>
                      <ArrowRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                      <span className="px-2 py-1 rounded font-semibold"
                            style={{ backgroundColor: 'var(--color-success-600)22', color: 'var(--color-success-600)', border: '1px solid var(--color-success-600)44' }}>
                        {idList(r.submitted_ids)}
                      </span>
                    </div>
                    {nameChanged && (
                      <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                        Name submitted: <strong>{`${r.submitted_first_name || ''} ${r.submitted_last_name || ''}`.trim()}</strong>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => reviewOne(r.user_id, 'approve')} disabled={busy}
                      title="Approve & apply"
                      className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-60"
                      style={{ backgroundColor: 'var(--color-success-600)' }}>
                      <Check size={13} />
                    </button>
                    <button onClick={() => reviewOne(r.user_id, 'reject')} disabled={busy}
                      title="Reject"
                      className="text-xs font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ color: 'var(--color-danger-700, #b91c1c)', backgroundColor: 'var(--color-danger-50, #fef2f2)', border: '1px solid var(--color-danger-200, #fecaca)' }}>
                      <X size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
