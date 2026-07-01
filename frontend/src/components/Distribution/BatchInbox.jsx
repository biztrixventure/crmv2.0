import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Boxes, Loader2, RefreshCw, X, Send, Trash2, GitBranch, Inbox, Upload, Globe,
  CheckCircle2, Circle, ChevronRight, ArrowDownRight, Ban, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import UserPicker from './UserPicker';
import RulePreview from './RulePreview';
import FilterBar from '../UI/FilterBar';

const SENDER_ROLES = new Set(['superadmin', 'compliance_manager', 'fronter_manager', 'closer_manager', 'operations_manager', 'company_admin']);
const EX_REASON = { already_assigned: 'already assigned', transferred_by_you: 'they transferred it', transferred_by_anyone: 'transferred by someone' };
const fmt = (d) => { try { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return d || ''; } };

// Batch distribution inbox — receive, re-batch (sub-batch = copy downstream),
// view lineage, and cascade-delete. Reads /distribution-batches.
export default function BatchInbox() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const canSend = SENDER_ROLES.has(user?.role);
  const [box, setBox] = useState('received');   // received | sent | all(superadmin)
  const [q, setQ] = useState('');
  const [dr, setDr] = useState({ date_from: '', date_to: '' });
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);   // batch being viewed

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = box === 'all' ? { scope: 'all' } : { box };
      if (q)           params.q = q;
      if (dr.date_from) params.date_from = dr.date_from;
      if (dr.date_to)   params.date_to = dr.date_to;
      if (companyId)   params.company_id = companyId;
      const r = await client.get('distribution-batches/received', { params });
      setRows(r.data.batches || []);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load batches'); setRows([]); }
    finally { setLoading(false); }
  }, [box, q, dr.date_from, dr.date_to, companyId]);
  useEffect(() => { load(); }, [load]);

  // Company options for the superadmin "extras" filter (existing /companies endpoint).
  useEffect(() => {
    if (!isSuper) return;
    client.get('companies').then(r => setCompanies(r.data?.companies || r.data || [])).catch(() => {});
  }, [isSuper]);

  const tabs = [['received', 'Received', Inbox], ['sent', 'Sent', Upload], ...(isSuper ? [['all', 'All', Globe]] : [])];
  const statusPills = (
    <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      {tabs.map(([k, label, Icon]) => (
        <button key={k} onClick={() => setBox(k)} className="text-xs font-semibold px-3 py-1.5 flex items-center gap-1"
          style={{ background: box === k ? 'var(--gradient-sidebar)' : 'transparent', color: box === k ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
  const extras = isSuper ? (
    <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input text-sm py-1.5" style={{ borderColor: 'var(--color-border)' }} aria-label="Company">
      <option value="">All companies</option>
      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Boxes size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Batch Distribution</h2>
        <button onClick={load} className="ml-auto p-2 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: 'Search batch, phone, or person…' }}
        dateRange={{ value: dr, onChange: setDr, defaultPreset: 'all' }}
        statusPills={statusPills}
        extras={extras}
        onClearAll={() => { setBox('received'); setCompanyId(''); }}
      />

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              {['Batch', 'From', 'To', 'Numbers', 'Sent', ''].map((h, i) => <th key={i} className="text-left font-semibold px-3 py-2 text-xs">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Boxes size={24} className="inline mb-1" /><div>No batches{box === 'received' ? ' received' : box === 'sent' ? ' sent' : ''}.</div></td></tr>
                : rows.map(b => (
                  <tr key={b.id} className="border-t hover:bg-black/[0.02] cursor-pointer" style={{ borderColor: 'var(--color-border)' }} onClick={() => setActive(b)}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>
                      {b.source === 'data_analyzer' && <span className="text-[9px] font-bold mr-1 px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>ORIGINAL</span>}
                      {b.name}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{b.created_by_name || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{b.sent_to_name || '—'}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text)' }}>{b.item_count}</td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(b.sent_at)}</td>
                    <td className="px-3 py-2 text-right"><ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {active && <BatchDetail batch={active} me={user} canSend={canSend} isSuper={isSuper} onClose={() => setActive(null)} onChanged={() => { setActive(null); load(); }} />}
    </div>
  );
}

// ── one batch: items + sub-batch + lineage + delete ───────────────────────────
function BatchDetail({ batch, me, canSend, isSuper, onClose, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(new Set());
  const [subOpen, setSubOpen] = useState(false);
  const [recipient, setRecipient] = useState(null);
  const [subName, setSubName] = useState('');
  const [saving, setSaving] = useState(false);
  const [lineage, setLineage] = useState(null);
  const [rules, setRules] = useState(null);
  const [subPreview, setSubPreview] = useState(null);
  const [subPreviewing, setSubPreviewing] = useState(false);
  const canDelete = isSuper || batch.created_by === me?.id;
  const rulesActive = rules && (rules.block_reassign_same_person || rules.skip_if_transferred_by_recipient || rules.skip_if_transferred_by_anyone);

  useEffect(() => {
    client.get(`distribution-batches/${batch.id}/items`).then(r => setItems(r.data.items || [])).catch(() => {}).finally(() => setLoading(false));
    client.get('distribution-batches/rules').then(r => setRules(r.data.rules)).catch(() => {});
  }, [batch.id]);

  // dry-run rule preview when a sub-batch recipient is chosen.
  // Y4 — recipient change / open fires immediately; selection toggles (which can
  // fire rapidly as the user checks many boxes) are debounced ~350ms so they
  // don't spam the preview RPC.
  const prevRecipRef = useRef(null);
  useEffect(() => {
    if (!subOpen || !recipient) { setSubPreview(null); prevRecipRef.current = null; return; }
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setSubPreviewing(true);
      client.post(`distribution-batches/${batch.id}/sub-batch/preview`, { recipient_id: recipient.id, item_ids: sel.size ? [...sel] : undefined })
        .then(r => { if (!cancelled) setSubPreview(r.data); }).catch(() => { if (!cancelled) setSubPreview(null); }).finally(() => { if (!cancelled) setSubPreviewing(false); });
    };
    const recipientChanged = prevRecipRef.current !== recipient.id;
    prevRecipRef.current = recipient.id;
    if (recipientChanged) { run(); return () => { cancelled = true; }; }
    const t = setTimeout(run, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [subOpen, recipient, sel, batch.id]);

  const selectable = items.filter(i => i.status !== 'excluded');
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = selectable.length > 0 && sel.size === selectable.length;
  const toggleAll = () => setSel(allSel ? new Set() : new Set(selectable.map(i => i.id)));

  const createSub = async () => {
    if (!recipient) return toast.error('Pick a recipient');
    setSaving(true);
    try {
      await client.post(`distribution-batches/${batch.id}/sub-batch`, {
        recipient_id: recipient.id, name: subName.trim() || undefined,
        item_ids: sel.size ? [...sel] : undefined,   // undefined = all items
      });
      toast.success(`Sub-batch sent to ${recipient.name} (${sel.size || items.length} numbers)`);
      onChanged();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not create sub-batch'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!window.confirm('Delete this batch AND every sub-batch it was re-sent to, everywhere downstream? This cannot be undone.')) return;
    setSaving(true);
    try {
      const r = await client.delete(`distribution-batches/${batch.id}`);
      toast.success(`Deleted ${r.data.deleted_batches} batch(es) across the chain`);
      onChanged();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not delete'); setSaving(false); }
  };

  const openLineage = async () => {
    try { const r = await client.get(`distribution-batches/${batch.id}/lineage`); setLineage(r.data); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not load lineage'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{batch.name}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{batch.item_count} numbers · from {batch.created_by_name || '—'} · {fmt(batch.sent_at)}</div>
          </div>
          <button onClick={openLineage} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}><GitBranch size={13} /> Lineage</button>
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
        </div>

        {lineage ? (
          <Lineage data={lineage} onBack={() => setLineage(null)} />
        ) : (
          <>
            <div className="px-4 py-2 flex items-center gap-2 text-xs" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <button onClick={toggleAll} className="flex items-center gap-1">{allSel ? <CheckCircle2 size={15} style={{ color: 'var(--color-primary-600)' }} /> : <Circle size={15} />}<span>{sel.size ? `${sel.size} selected` : 'Select all'}</span></button>
            </div>
            {rulesActive && (
              <div className="px-4 py-1.5 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-warning-600)', borderBottom: '1px solid var(--color-border)' }}>
                <Filter size={11} /> Skip rules active — matching numbers are excluded when a fronter receives this.
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-2">
              {loading ? <div className="text-center py-8"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
                : items.map(i => {
                  const excluded = i.status === 'excluded';
                  const on = sel.has(i.id);
                  return (
                    <div key={i.id} onClick={() => !excluded && toggle(i.id)} className="w-full text-left flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg"
                      style={{ background: on ? 'var(--color-surface-hover)' : 'transparent', opacity: excluded ? 0.6 : 1, cursor: excluded ? 'default' : 'pointer' }}>
                      {excluded ? <Ban size={16} style={{ color: 'var(--color-warning-600)' }} /> : on ? <CheckCircle2 size={16} style={{ color: 'var(--color-primary-600)' }} /> : <Circle size={16} style={{ color: 'var(--color-text-tertiary)' }} />}
                      <span className="tabular-nums text-sm font-semibold" style={{ color: 'var(--color-text)', textDecoration: excluded ? 'line-through' : 'none' }}>{i.phone_number}</span>
                      {i.customer_name && <span className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{i.customer_name}</span>}
                      {excluded
                        ? <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: 'var(--color-warning-600)' }}>excluded · {EX_REASON[i.exclusion_reason] || i.exclusion_reason}</span>
                        : <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{i.status}</span>}
                    </div>
                  );
                })}
            </div>

            <div className="p-4 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              {subOpen && canSend && (
                <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Create sub-batch — copies {sel.size ? `${sel.size} selected` : `all ${items.length}`} numbers to a new recipient (this batch keeps its copy).</div>
                  <input value={subName} onChange={e => setSubName(e.target.value)} placeholder="Sub-batch name (optional)" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                  <UserPicker value={recipient} onChange={setRecipient} />
                  {recipient && <RulePreview preview={subPreview} previewing={subPreviewing} recipientName={recipient.name} />}
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => setSubOpen(false)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
                    <button onClick={createSub} disabled={saving || !recipient} className="text-sm font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send</button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                {canDelete && <button onClick={del} disabled={saving} className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1" style={{ color: 'var(--color-error-600)' }}><Trash2 size={13} /> Delete (cascades downstream)</button>}
                {canSend && !subOpen && <button onClick={() => setSubOpen(true)} className="ml-auto text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}><Send size={15} /> Create sub-batch</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Lineage({ data, onBack }) {
  const Row = ({ b }) => (
    <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: (b.depth || 0) * 16 }}>
      {b.depth > 0 && <ArrowDownRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
      <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: b.source === 'data_analyzer' ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>{b.source === 'data_analyzer' ? 'ORIGINAL' : 'SUB'}</span>
      <span className="text-sm font-medium" style={{ color: b.status === 'deleted' ? 'var(--color-text-tertiary)' : 'var(--color-text)', textDecoration: b.status === 'deleted' ? 'line-through' : 'none' }}>{b.name}</span>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{b.created_by_name} → {b.sent_to_name}</span>
    </div>
  );
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <button onClick={onBack} className="text-xs font-semibold mb-3" style={{ color: 'var(--color-primary-600)' }}>← Back to items</button>
      <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Ancestors (origin → here)</div>
      {(data.ancestors || []).slice().reverse().map(b => <Row key={b.id} b={{ ...b, depth: 0 }} />)}
      <div className="text-[10px] font-bold uppercase tracking-wide mt-4 mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Descendants (everywhere re-sent)</div>
      {(data.descendants || []).map(b => <Row key={b.id} b={b} />)}
    </div>
  );
}
