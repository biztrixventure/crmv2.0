import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Loader2, Users, Send, Trash2, GitBranch, RefreshCw, Search, StickyNote,
  PhoneForwarded, Clock, ThumbsDown, Voicemail, PhoneOff, CheckCircle2, Circle,
  Activity, ChevronLeft, ChevronRight, UserMinus,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import UserPicker from './UserPicker';
import { Lineage } from './BatchLineage';

// One batch, worked end to end: every number in it (1000+ rows, paged), every
// column the file carried, who holds each number, what the fronter did with it,
// and what they wrote. Managers assign from here; fronters disposition from here.
// Nothing leaves the batch — a transferred number becomes a row in the
// Transferred tab, so the level above still sees it.

export const STATUS_META = {
  new:               { label: 'New',               color: '#2563eb' },
  assigned:          { label: 'Assigned',          color: '#4f46e5' },
  called:            { label: 'Called',            color: '#d97706' },
  callback:          { label: 'Callback',          color: '#7c3aed' },
  transferred:       { label: 'Transferred',       color: '#059669' },
  not_interested:    { label: 'Not interested',    color: '#dc2626' },
  answering_machine: { label: 'Answering machine', color: '#0891b2' },
  no_answer:         { label: 'No answer',         color: '#64748b' },
  completed:         { label: 'Completed',         color: '#16a34a' },
  skip:              { label: 'Skip',              color: '#6b7280' },
  excluded:          { label: 'Excluded',          color: '#b45309' },
};
// The one-click outcomes the fronter needs on the record itself.
const DISPOSITIONS = [
  { key: 'transferred',       label: 'Transfer',       icon: PhoneForwarded },
  { key: 'callback',          label: 'Callback',       icon: Clock },
  { key: 'not_interested',    label: 'Not interested', icon: ThumbsDown },
  { key: 'answering_machine', label: 'Answering m/c',  icon: Voicemail },
  { key: 'no_answer',         label: 'No answer',      icon: PhoneOff },
];
const TAB_ORDER = ['all', 'unassigned', 'assigned', 'new', 'called', 'callback', 'transferred',
                   'not_interested', 'answering_machine', 'no_answer', 'completed', 'skip', 'excluded'];
const fmt = (d) => { try { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return d || ''; } };

export default function BatchWorkspace({ batch, me, canSend, isSuper, onClose, onChanged }) {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [cols, setCols] = useState([]);
  const [meta, setMeta] = useState(batch);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ counts: {}, total: 0, assigned: 0, unassigned: 0 });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(new Set());
  const [view, setView] = useState('items');       // items | activity | people | lineage
  const [activity, setActivity] = useState([]);
  const [board, setBoard] = useState(null);        // per-person scoreboard
  const [lineage, setLineage] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [noteFor, setNoteFor] = useState(null);    // item being noted
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const isHolder = meta?.sent_to_user_id === me?.id;
  const canDelete = isSuper || meta?.created_by === me?.id;
  // A number is worked by the person holding the batch — and a manager can fix a
  // wrong disposition on a batch they sent.
  const canDisposition = isHolder || isSuper || meta?.created_by === me?.id;

  const params = useMemo(() => {
    const p = { limit, offset: (page - 1) * limit };
    if (q.trim()) p.q = q.trim();
    if (tab === 'unassigned') p.assigned = 'no';
    else if (tab !== 'all') p.status = tab;
    return p;
  }, [limit, page, q, tab]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get(`distribution-batches/${batch.id}/items`, { params });
      setItems(r.data.items || []); setTotal(r.data.total || 0);
      setCols(r.data.batch?.columns || []); setMeta(m => ({ ...m, ...r.data.batch }));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load numbers'); setItems([]); }
    finally { setLoading(false); }
  }, [batch.id, params]);
  useEffect(() => { load(); }, [load]);

  const loadCounts = useCallback(() => {
    client.get(`distribution-batches/${batch.id}/status-counts`).then(r => setCounts(r.data)).catch(() => {});
  }, [batch.id]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  // filter changes restart paging + drop a stale selection
  useEffect(() => { setPage(1); setSel(new Set()); }, [tab, q, limit]);

  const openActivity = async () => {
    setView('activity');
    try { const r = await client.get(`distribution-batches/${batch.id}/activity`, { params: { limit: 200 } }); setActivity(r.data.activity || []); }
    catch { setActivity([]); }
  };
  const openPeople = async () => {
    setView('people');
    try { const r = await client.get(`distribution-batches/${batch.id}/scoreboard`); setBoard(r.data); }
    catch { setBoard({ people: [], totals: {} }); }
  };
  const openLineage = async () => {
    try { const r = await client.get(`distribution-batches/${batch.id}/lineage`); setLineage(r.data); setView('lineage'); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not load lineage'); }
  };

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = items.length > 0 && items.every(i => sel.has(i.id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(items.map(i => i.id)));

  const setStatus = async (item, status) => {
    try {
      await client.put(`distribution-batches/items/${item.id}`, { status });
      setItems(list => list.map(i => i.id === item.id ? { ...i, status } : i));
      loadCounts();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not update'); }
  };
  const bulkStatus = async (status) => {
    if (!sel.size) return;
    setBusy(true);
    try {
      const r = await client.put('distribution-batches/items-bulk/apply', { item_ids: [...sel], status });
      toast.success(`${r.data.updated} updated${r.data.skipped ? `, ${r.data.skipped} skipped` : ''}`);
      setSel(new Set()); load(); loadCounts();
    } catch (e) { toast.error(e.response?.data?.error || 'Bulk update failed'); }
    finally { setBusy(false); }
  };
  const saveNote = async () => {
    if (!noteFor) return;
    try {
      await client.put(`distribution-batches/items/${noteFor.id}`, { notes: noteText });
      setItems(list => list.map(i => i.id === noteFor.id ? { ...i, notes: noteText } : i));
      setNoteFor(null); setNoteText('');
    } catch (e) { toast.error(e.response?.data?.error || 'Could not save the note'); }
  };
  const unassign = async () => {
    if (!sel.size) return;
    setBusy(true);
    try {
      const r = await client.post(`distribution-batches/${batch.id}/unassign`, { item_ids: [...sel] });
      toast.success(`${r.data.unassigned} taken back${r.data.skipped ? `, ${r.data.skipped} already worked` : ''}`);
      setSel(new Set()); load(); loadCounts();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not unassign'); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm('Delete this batch AND every sub-batch it was sent to?\n\nEveryone it was assigned to loses it. Numbers nobody has worked yet go back to unassigned so they can be dealt again. This cannot be undone.')) return;
    try {
      const r = await client.delete(`distribution-batches/${batch.id}`);
      toast.success(`Deleted ${r.data.deleted_batches} batch(es)${r.data.released_numbers ? ` · ${r.data.released_numbers} numbers freed to assign again` : ''}`);
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not delete'); }
  };

  const pages = Math.max(1, Math.ceil(total / limit));
  const tabCount = (t) => t === 'all' ? counts.total : t === 'unassigned' ? counts.unassigned : (counts.counts?.[t] || 0);
  const visibleTabs = TAB_ORDER.filter(t => ['all', 'unassigned', 'assigned', 'transferred', 'callback'].includes(t) || tabCount(t) > 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onClose} className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><ChevronLeft size={16} /></button>
        <div className="min-w-0">
          <div className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{meta.name}</div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {counts.total} numbers · <span style={{ color: '#4f46e5' }}>{counts.assigned} assigned</span> · <span style={{ color: 'var(--color-text-tertiary)' }}>{counts.unassigned} free</span>
            {meta.file_name ? ` · ${meta.file_name}` : ''}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { setView('items'); load(); loadCounts(); }} className="p-2 rounded-lg" style={{ border: '1px solid var(--color-border)' }} title="Refresh"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-text-secondary)' }} /></button>
          <button onClick={openPeople} className="text-xs font-semibold px-2.5 py-2 rounded-lg flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)', color: view === 'people' ? 'var(--color-primary-600)' : 'var(--color-text)' }}><Users size={14} /> By person</button>
          <button onClick={openActivity} className="text-xs font-semibold px-2.5 py-2 rounded-lg flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)', color: view === 'activity' ? 'var(--color-primary-600)' : 'var(--color-text)' }}><Activity size={14} /> Activity</button>
          <button onClick={openLineage} className="text-xs font-semibold px-2.5 py-2 rounded-lg flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}><GitBranch size={14} /> Lineage</button>
          {canSend && <button onClick={() => setAssignOpen(true)} className="text-sm font-bold px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}><Users size={15} /> Assign</button>}
          {canDelete && <button onClick={del} className="p-2 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-error-600)' }} title="Delete batch"><Trash2 size={15} /></button>}
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
        </div>
      </div>

      {view === 'lineage' ? (
        <div className="flex-1 overflow-y-auto"><Lineage data={lineage} onBack={() => setView('items')} /></div>
      ) : view === 'people' ? (
        <Scoreboard board={board} onBack={() => setView('items')} />
      ) : view === 'activity' ? (
        <div className="flex-1 overflow-y-auto p-4">
          <button onClick={() => setView('items')} className="text-xs font-semibold mb-3" style={{ color: 'var(--color-primary-600)' }}>← Back to numbers</button>
          {activity.length === 0 ? <div className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>No activity yet.</div> : (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {activity.map(a => (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{a.phone_number || '—'}</span>
                  {a.customer_name && <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{a.customer_name}</span>}
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${(STATUS_META[a.to_status]?.color || '#64748b')}1a`, color: STATUS_META[a.to_status]?.color || '#64748b' }}>
                    {a.action === 'assigned' ? 'assigned' : a.action === 'note' ? 'note' : (STATUS_META[a.to_status]?.label || a.to_status)}
                  </span>
                  {a.note && <span className="text-xs italic truncate" style={{ color: 'var(--color-text-secondary)' }}>“{a.note}”</span>}
                  <span className="ml-auto text-xs" style={{ color: 'var(--color-text-secondary)' }}>{a.actor_name || '—'}</span>
                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* status tabs — a disposition never leaves the batch, it moves tab */}
          <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {visibleTabs.map(t => {
              const on = tab === t;
              const color = t === 'all' ? 'var(--color-primary-600)' : t === 'unassigned' ? '#64748b' : (STATUS_META[t]?.color || '#64748b');
              const label = t === 'all' ? 'All' : t === 'unassigned' ? 'Unassigned' : (STATUS_META[t]?.label || t);
              return (
                <button key={t} onClick={() => setTab(t)} className="text-xs font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap transition-colors"
                  style={{ background: on ? color : 'var(--color-surface)', color: on ? '#fff' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {label} <span className="tabular-nums opacity-80">{tabCount(t)}</span>
                </button>
              );
            })}
          </div>

          {/* toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, name, note or any field…"
                className="text-xs rounded-lg pl-7 pr-2 py-1.5 w-64" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <button onClick={toggleAll} className="text-xs font-semibold flex items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {allSel ? <CheckCircle2 size={14} style={{ color: 'var(--color-primary-600)' }} /> : <Circle size={14} />} {sel.size ? `${sel.size} selected` : 'Select page'}
            </button>
            {sel.size > 0 && canDisposition && (
              <div className="flex items-center gap-1 flex-wrap">
                {DISPOSITIONS.map(d => (
                  <button key={d.key} onClick={() => bulkStatus(d.key)} disabled={busy} className="text-xs font-semibold px-2 py-1.5 rounded-lg flex items-center gap-1"
                    style={{ border: `1px solid ${STATUS_META[d.key].color}`, color: STATUS_META[d.key].color }}><d.icon size={12} /> {d.label}</button>
                ))}
              </div>
            )}
            {sel.size > 0 && canSend && (
              <button onClick={unassign} disabled={busy} className="text-xs font-semibold px-2 py-1.5 rounded-lg flex items-center gap-1" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><UserMinus size={12} /> Unassign</button>
            )}
            <div className="ml-auto flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              <span>{total ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}` : '0'}</span>
              {[100, 250, 500, 1000].map(n => (
                <button key={n} onClick={() => setLimit(n)} className="text-[11px] font-bold px-1.5 py-1 rounded"
                  style={{ background: limit === n ? 'var(--color-primary-600)' : 'var(--color-surface)', color: limit === n ? '#fff' : 'var(--color-text-secondary)' }}>{n}</button>
              ))}
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronLeft size={13} /></button>
              <span className="tabular-nums">{page}/{pages}</span>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} className="p-1 rounded disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronRight size={13} /></button>
            </div>
          </div>

          {/* the numbers — file columns included, in the file's own order */}
          <div className="flex-1 overflow-auto">
            {loading ? <div className="text-center py-14"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
              : items.length === 0 ? <div className="text-center py-14 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No numbers in this view.</div>
              : (
                <table className="text-sm" style={{ minWidth: '100%' }}>
                  <thead className="sticky top-0" style={{ background: 'var(--color-surface)', zIndex: 1 }}>
                    <tr>
                      {['', '#', 'Number', 'Name', 'Status', 'Holder', 'Note', ...(canDisposition ? ['Outcome'] : []), ...cols].map((h, i) => (
                        <th key={i} className="text-left font-semibold px-2 py-2 text-[11px] uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const m = STATUS_META[it.status] || { label: it.status, color: '#64748b' };
                      return (
                        <tr key={it.id} style={{ borderTop: '1px solid var(--color-border)', background: sel.has(it.id) ? 'var(--color-surface-hover)' : 'transparent' }}>
                          <td className="px-2 py-1.5"><button onClick={() => toggle(it.id)}>{sel.has(it.id) ? <CheckCircle2 size={15} style={{ color: 'var(--color-primary-600)' }} /> : <Circle size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button></td>
                          <td className="px-2 py-1.5 tabular-nums text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{it.position}</td>
                          <td className="px-2 py-1.5 tabular-nums font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{it.phone_number}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{it.customer_name || '—'}</td>
                          <td className="px-2 py-1.5"><span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${m.color}1a`, color: m.color }}>{m.label}</span></td>
                          <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{it.assigned_to_name || '—'}</td>
                          <td className="px-2 py-1.5 max-w-[220px]">
                            <button onClick={() => { setNoteFor(it); setNoteText(it.notes || ''); }} className="flex items-center gap-1 text-xs text-left" style={{ color: it.notes ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
                              <StickyNote size={12} /> <span className="truncate">{it.notes || 'add note'}</span>
                            </button>
                          </td>
                          {canDisposition && (
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                {DISPOSITIONS.map(d => (
                                  <button key={d.key} title={d.label} onClick={() => setStatus(it, d.key)} className="p-1 rounded"
                                    style={{ border: `1px solid ${it.status === d.key ? STATUS_META[d.key].color : 'var(--color-border)'}`, color: it.status === d.key ? '#fff' : STATUS_META[d.key].color, background: it.status === d.key ? STATUS_META[d.key].color : 'transparent' }}>
                                    <d.icon size={12} />
                                  </button>
                                ))}
                              </div>
                            </td>
                          )}
                          {cols.map(c => <td key={c} className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{it.data?.[c] ?? ''}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}

      {assignOpen && <AssignPanel batchId={batch.id} unassigned={counts.unassigned} selectedIds={[...sel]}
        onClose={() => setAssignOpen(false)} onDone={() => { setAssignOpen(false); setSel(new Set()); load(); loadCounts(); }} />}

      {noteFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setNoteFor(null)}>
          <div className="w-full max-w-md rounded-2xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
            <div className="font-bold mb-1" style={{ color: 'var(--color-text)' }}>Note · {noteFor.phone_number}</div>
            <div className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>Everyone above this batch can read it.</div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={5} className="w-full text-sm rounded-lg p-2"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setNoteFor(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={saveNote} className="text-sm font-bold px-3 py-1.5 rounded-lg" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── who is actually working this batch ────────────────────────────────────────
// Ordered by transfers, because that is the column the manager is looking for.
// "Worked %" is of what they were GIVEN; "Transfer %" is of what they WORKED —
// mixing those two into one number hides the lazy-but-lucky agent.
function Scoreboard({ board, onBack }) {
  if (!board) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  const { people = [], totals = {} } = board;
  const bar = (pct, color) => (
    <div className="h-1.5 rounded-full mt-1" style={{ background: 'var(--color-bg-secondary)' }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
  const cell = (v, color) => <td className="px-2 py-2 tabular-nums text-center" style={{ color: v ? (color || 'var(--color-text)') : 'var(--color-text-tertiary)' }}>{v || '—'}</td>;

  return (
    <div className="flex-1 overflow-auto p-4">
      <button onClick={onBack} className="text-xs font-semibold mb-3" style={{ color: 'var(--color-primary-600)' }}>← Back to numbers</button>
      {people.length === 0 ? (
        <div className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>Nothing assigned yet — assign numbers and the scoreboard fills in.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[['Assigned', totals.assigned, 'var(--color-text)'], ['Worked', totals.worked, '#d97706'],
              ['Transferred', totals.transferred, '#059669'], ['Touches', totals.touches, 'var(--color-text-secondary)']].map(([l, v, c]) => (
              <div key={l} className="rounded-xl p-3" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{l}</div>
                <div className="text-2xl font-extrabold tabular-nums" style={{ color: c }}>{v || 0}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--color-surface)' }}>
                {['Person', 'Assigned', 'Worked', 'Left', 'Transfer', 'Callback', 'Not int.', 'Ans m/c', 'No ans', 'Called', 'Touches', 'Transfer %', 'Last activity'].map((h, i) => (
                  <th key={h} className={`px-2 py-2 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${i === 0 ? 'text-left' : 'text-center'}`} style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.user_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-2 py-2 min-w-[160px]">
                      <div className="font-semibold" style={{ color: 'var(--color-text)' }}>{p.name}</div>
                      <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{p.worked_pct}% of their list worked</div>
                      {bar(p.worked_pct, '#d97706')}
                    </td>
                    {cell(p.assigned)}
                    {cell(p.worked, '#d97706')}
                    {cell(p.untouched, 'var(--color-text-secondary)')}
                    {cell(p.transferred, STATUS_META.transferred.color)}
                    {cell(p.callback, STATUS_META.callback.color)}
                    {cell(p.not_interested, STATUS_META.not_interested.color)}
                    {cell(p.answering_machine, STATUS_META.answering_machine.color)}
                    {cell(p.no_answer, STATUS_META.no_answer.color)}
                    {cell(p.called, STATUS_META.called.color)}
                    {cell(p.touches, 'var(--color-text-secondary)')}
                    <td className="px-2 py-2 tabular-nums text-center font-bold" style={{ color: p.transfer_pct >= 10 ? '#059669' : 'var(--color-text-secondary)' }}>{p.worked ? `${p.transfer_pct}%` : '—'}</td>
                    <td className="px-2 py-2 text-[11px] whitespace-nowrap text-center" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(p.last_activity) || 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Worked % = of what they were given. Transfer % = of what they actually worked. Touches counts every disposition, so a callback that later transfers shows as two.
          </div>
        </>
      )}
    </div>
  );
}

// ── assignment: every way the user asked to deal numbers out ──────────────────
// selected rows · N per person · even split of what's left. Only unassigned rows
// are ever dealt, so nobody gets a number someone else already holds.
function AssignPanel({ batchId, unassigned, selectedIds, onClose, onDone }) {
  const [people, setPeople] = useState([]);
  const [mode, setMode] = useState(selectedIds.length ? 'selected' : 'per');   // selected | per | even
  const [per, setPer] = useState(100);
  const [order, setOrder] = useState('sequential');
  const [busy, setBusy] = useState(false);

  const toggle = (u) => setPeople(ps => ps.some(x => x.id === u.id) ? ps.filter(x => x.id !== u.id) : [...ps, u]);
  const n = people.length;
  const plannedTotal = mode === 'selected' ? selectedIds.length : mode === 'per' ? Math.min(per * n, unassigned) : unassigned;

  const go = async () => {
    if (!n) return toast.error('Pick at least one person');
    if (mode === 'selected' && !selectedIds.length) return toast.error('No rows selected');
    setBusy(true);
    try {
      let assignments;
      if (mode === 'selected') {
        // the chosen rows, dealt evenly across the chosen people
        const chunk = Math.ceil(selectedIds.length / n);
        assignments = people.map((u, i) => ({ recipient_id: u.id, item_ids: selectedIds.slice(i * chunk, (i + 1) * chunk) }));
      } else if (mode === 'per') {
        assignments = people.map(u => ({ recipient_id: u.id, count: per }));
      } else {
        assignments = people.map(u => ({ recipient_id: u.id }));   // count omitted = even share
      }
      const r = await client.post(`distribution-batches/${batchId}/assign`, { assignments, mode: order });
      toast.success(`Assigned ${r.data.assigned} numbers to ${r.data.children.length} people · ${r.data.remaining_unassigned} left`);
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not assign'); }
    finally { setBusy(false); }
  };

  const Mode = ({ k, label, hint }) => (
    <button onClick={() => setMode(k)} className="text-left px-3 py-2 rounded-lg flex-1"
      style={{ border: `1px solid ${mode === k ? 'var(--color-primary-600)' : 'var(--color-border)'}`, background: mode === k ? 'var(--color-surface-hover)' : 'transparent' }}>
      <div className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{label}</div>
      <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{hint}</div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Users size={17} style={{ color: 'var(--color-primary-600)' }} />
          <div className="font-bold flex-1" style={{ color: 'var(--color-text)' }}>Assign numbers</div>
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={17} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {unassigned} unassigned in this batch{selectedIds.length ? ` · ${selectedIds.length} rows selected` : ''}. Assigned numbers lock to that person — nobody else can be given them.
          </div>
          <div className="flex gap-2">
            <Mode k="selected" label="Selected rows" hint={`${selectedIds.length} chosen`} />
            <Mode k="per" label="N per person" hint="e.g. 100 each" />
            <Mode k="even" label="Even split" hint="all that's left" />
          </div>
          {mode === 'per' && (
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Numbers per person
              <input type="number" min={1} value={per} onChange={e => setPer(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-24 text-sm rounded-lg px-2 py-1 tabular-nums" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </label>
          )}
          <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--color-border)' }}>
            {[['sequential', 'In file order'], ['random', 'Random']].map(([k, label]) => (
              <button key={k} onClick={() => setOrder(k)} className="text-xs font-semibold px-3 py-1.5"
                style={{ background: order === k ? 'var(--gradient-sidebar)' : 'transparent', color: order === k ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>{label}</button>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              To whom — any user, any level (fronter, manager, compliance…)
            </div>
            <UserPicker multiple selected={people} onToggle={toggle} placeholder="Add people…" />
          </div>
          {n > 0 && (
            <div className="text-xs rounded-lg p-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {plannedTotal} numbers → {n} {n === 1 ? 'person' : 'people'}
              {mode === 'per' && per * n > unassigned ? <span style={{ color: 'var(--color-warning-600)' }}> · only {unassigned} free, the last people get fewer</span> : ''}
            </div>
          )}
        </div>
        <div className="p-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={go} disabled={busy || !n} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Assign
          </button>
        </div>
      </div>
    </div>
  );
}
