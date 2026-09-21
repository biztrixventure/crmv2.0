import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, Loader2, Upload, FileSpreadsheet, UserMinus, UserPlus, Users,
  CheckCircle2, Circle, ChevronLeft, Clock, AlertTriangle, Copy, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import UserPicker from './UserPicker';
import ExpiryPicker, { EMPTY_EXPIRY, expiryPayload } from './ExpiryPicker';
import { STATUS_META } from './BatchWorkspace';
import { timeLeft, fmtDeadline } from '../../utils/expiry';

// ── "who has these numbers?" ─────────────────────────────────────────────────
// Paste a list, or drop in the file that was handed out in the first place, and
// see every person currently holding each number — the whole chain, not just the
// last hop. From the same screen the numbers can be taken back, or taken back
// and handed to somebody else in one action.
//
// Manager and up. The scoping is decided server-side (app_batch_number_lookup):
// superadmin and compliance see every company, a manager sees their own tree
// plus their companies' agents — so this can never become a way to read another
// tenant's floor.

// Any text that might contain numbers: a pasted column, a comma list, a whole
// CSV. Digit runs are pulled out and only real 10-digit US numbers are kept, so
// lead ids and prices in the same file are ignored instead of searched for.
export function extractPhones(text) {
  const out = []; const seen = new Set();
  for (const run of String(text || '').match(/\d+/g) || []) {
    const phone = run.length === 11 && run[0] === '1' ? run.slice(1) : run;
    if (phone.length !== 10 || seen.has(phone)) continue;
    seen.add(phone); out.push(phone);
  }
  return out;
}

const parseFile = async (file) => {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv' || ext === 'txt') return extractPhones(await file.text());
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    // every sheet, every cell — the phone column is wherever it happens to be
    const cells = wb.SheetNames.flatMap(n =>
      XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }).flat());
    return extractPhones(cells.join(' '));
  }
  throw new Error('Upload a .csv, .txt or .xlsx file');
};

const fmt = (d) => { try { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return d || ''; } };

export default function NumberFinder({ onClose }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [pending, setPending] = useState([]);        // phones read out of a file
  const [includeRecalled, setIncludeRecalled] = useState(false);
  const [data, setData] = useState(null);            // the lookup response
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(new Set());         // holder rows (item_id)
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  const typed = useMemo(() => extractPhones(text), [text]);
  const phones = pending.length ? pending : typed;

  const pickFile = async (f) => {
    if (!f) return;
    try {
      const found = await parseFile(f);
      if (!found.length) return toast.error('No 10-digit numbers found in that file');
      setPending(found); setFileName(f.name); setText('');
      toast.success(`${found.length} numbers read from ${f.name}`);
    } catch (e) { toast.error(e.message || 'Could not read that file'); }
  };

  const search = async () => {
    if (!phones.length) return toast.error('Paste some numbers, or upload the file');
    setLoading(true); setSel(new Set());
    try {
      const r = await client.post('distribution-batches/number-lookup', {
        phones, include_recalled: includeRecalled,
      });
      setData(r.data);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not look those numbers up'); }
    finally { setLoading(false); }
  };

  // one flat list of holder rows, so selection and the bulk actions stay simple
  const rows = useMemo(() => {
    if (!data) return [];
    return data.results.flatMap(r => r.holders.map((h, i) => ({ ...h, phone: r.phone, first: i === 0, of: r.holders.length })));
  }, [data]);
  const selectable = rows.filter(r => r.can_recall);
  const allSel = selectable.length > 0 && selectable.every(r => sel.has(r.item_id));
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(selectable.map(r => r.item_id)));

  const recall = async (ids) => {
    if (!ids.length) return;
    const holders = [...new Set(rows.filter(r => ids.includes(r.item_id)).map(r => r.holder_name || 'someone'))];
    if (!window.confirm(`Take ${ids.length} number${ids.length === 1 ? '' : 's'} back from ${holders.slice(0, 3).join(', ')}${holders.length > 3 ? ` and ${holders.length - 3} more` : ''}?\n\nThey disappear from that person's list immediately. Numbers nobody has worked go back to unassigned so they can be handed out again; a number that was already worked keeps its outcome.`)) return;
    setBusy(true);
    try {
      const r = await client.post('distribution-batches/recall', { item_ids: ids, reason: 'taken back from the number report' });
      toast.success(`${r.data.recalled} taken back · ${r.data.released} free to assign again`);
      setSel(new Set()); search();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not take those back'); }
    finally { setBusy(false); }
  };

  const summary = data ? `${data.found} of ${data.searched} numbers are with someone` : '';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onClose} className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><ChevronLeft size={16} /></button>
        <div className="min-w-0">
          <div className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Search size={16} style={{ color: 'var(--color-primary-600)' }} /> Find numbers</div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {data ? summary : 'Paste numbers or upload the file you handed out — see who is holding each one.'}
          </div>
        </div>
        <button onClick={onClose} className="ml-auto" style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
      </div>

      {/* the ask */}
      <div className="px-4 py-3 flex flex-wrap items-start gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex-1 min-w-[260px]">
          <textarea value={text} onChange={e => { setText(e.target.value); setPending([]); setFileName(''); }}
            rows={3} placeholder="Paste numbers — one per line, commas, or a whole column copied out of Excel"
            className="w-full text-sm rounded-lg p-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            {fileName
              ? <span className="flex items-center gap-1"><FileSpreadsheet size={12} /> {fileName} · {pending.length} numbers</span>
              : `${typed.length} valid number${typed.length === 1 ? '' : 's'} recognised`}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
            onChange={e => pickFile(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <Upload size={14} /> Upload a file
          </button>
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={includeRecalled} onChange={e => setIncludeRecalled(e.target.checked)} />
            Include ones already taken back
          </label>
          <button onClick={search} disabled={loading || !phones.length}
            className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search {phones.length ? `(${phones.length})` : ''}
          </button>
        </div>
      </div>

      {/* what came back */}
      {!data ? (
        <div className="flex-1 flex items-center justify-center text-sm px-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          {loading ? <Loader2 className="animate-spin" /> : 'Nothing searched yet.'}
        </div>
      ) : (
        <>
          {/* bulk bar */}
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <button onClick={toggleAll} disabled={!selectable.length} className="text-xs font-semibold flex items-center gap-1.5 px-2 py-1.5 rounded-lg disabled:opacity-40"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {allSel ? <CheckCircle2 size={14} style={{ color: 'var(--color-primary-600)' }} /> : <Circle size={14} />}
              {sel.size ? `${sel.size} selected` : 'Select all I can act on'}
            </button>
            {sel.size > 0 && (
              <>
                <button onClick={() => recall([...sel])} disabled={busy} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                  style={{ border: '1px solid var(--color-error-600)', color: 'var(--color-error-600)' }}>
                  <UserMinus size={13} /> Take back
                </button>
                <button onClick={() => setMoveOpen(true)} disabled={busy} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                  style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
                  <UserPlus size={13} /> Take back & give to…
                </button>
              </>
            )}
            {data.not_found.length > 0 && (
              <button onClick={() => setShowMissing(m => !m)} className="ml-auto text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <AlertTriangle size={13} style={{ color: 'var(--color-warning-600)' }} />
                {data.not_found.length} with nobody
              </button>
            )}
          </div>

          {showMissing && data.not_found.length > 0 && (
            <div className="px-4 py-2 text-xs" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">Not with anyone right now</span>
                <button onClick={() => { navigator.clipboard?.writeText(data.not_found.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
                  className="flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
                  {copied ? <><Check size={12} /> copied</> : <><Copy size={12} /> copy</>}
                </button>
              </div>
              <div className="tabular-nums max-h-24 overflow-y-auto">{data.not_found.join(', ')}</div>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <div className="text-center py-14 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                None of those numbers is sitting with anyone you can see.
              </div>
            ) : (
              <table className="text-sm" style={{ minWidth: '100%' }}>
                <thead className="sticky top-0" style={{ background: 'var(--color-surface)', zIndex: 1 }}>
                  <tr>
                    {['', 'Number', 'Held by', 'Batch', 'Status', 'Given', 'Time limit', 'Chain', ''].map((h, i) => (
                      <th key={i} className="text-left font-semibold px-2 py-2 text-[11px] uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const m = STATUS_META[r.status] || { label: r.status, color: '#64748b' };
                    const t = timeLeft(r.expires_at);
                    return (
                      <tr key={r.item_id} style={{
                        borderTop: r.first ? '2px solid var(--color-border)' : '1px solid var(--color-border)',
                        background: sel.has(r.item_id) ? 'var(--color-surface-hover)' : (r.recalled_at ? 'var(--color-surface)' : 'transparent'),
                        opacity: r.recalled_at ? 0.6 : 1,
                      }}>
                        <td className="px-2 py-1.5">
                          {r.can_recall
                            ? <button onClick={() => toggle(r.item_id)}>{sel.has(r.item_id) ? <CheckCircle2 size={15} style={{ color: 'var(--color-primary-600)' }} /> : <Circle size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button>
                            : <span title="Sent by someone outside your chain — you can see it, but not take it back"><Circle size={15} style={{ color: 'var(--color-border)' }} /></span>}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums font-semibold whitespace-nowrap" style={{ color: r.first ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
                          {r.first ? r.phone : '↳'}
                          {r.first && r.of > 1 && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{r.of} places</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                          {r.holder_name || '—'}
                          {r.passed_on && <span className="ml-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>· passed on</span>}
                          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>from {r.sender_name || '—'}</div>
                        </td>
                        <td className="px-2 py-1.5 max-w-[220px] truncate" style={{ color: 'var(--color-text-secondary)' }} title={r.batch_name}>
                          {r.batch_name}
                          {r.batch_status !== 'active' && <span className="ml-1 text-[10px] font-bold" style={{ color: 'var(--color-warning-600)' }}>{r.batch_status}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${m.color}1a`, color: m.color }}>{m.label}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(r.assigned_at || r.sent_at)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-[11px]">
                          {r.expires_at ? (
                            <span className="flex items-center gap-1 font-semibold" title={fmtDeadline(r.expires_at)}
                              style={{ color: (t.expired || t.urgent) ? 'var(--color-error-600)' : t.soon ? 'var(--color-warning-600)' : 'var(--color-text-secondary)' }}>
                              <Clock size={11} /> {t.text}
                            </span>
                          ) : <span style={{ color: 'var(--color-text-tertiary)' }}>no limit</span>}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>hop {r.hop}</td>
                        <td className="px-2 py-1.5 text-right">
                          {r.recalled_at
                            ? <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>taken back {fmt(r.recalled_at)}</span>
                            : r.can_recall && (
                              <button onClick={() => recall([r.item_id])} disabled={busy}
                                className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                                Take back
                              </button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {moveOpen && (
        <MovePanel itemIds={[...sel]} count={sel.size}
          onClose={() => setMoveOpen(false)}
          onDone={() => { setMoveOpen(false); setSel(new Set()); search(); }} />
      )}
    </div>,
    document.body,
  );
}

// ── take back from one person and hand to another, in one action ─────────────
// Two steps (take back, then hunt for the freed rows in whichever batch they
// came from) is how numbers end up sitting free in a batch nobody is watching.
function MovePanel({ itemIds, count, onClose, onDone }) {
  const [person, setPerson] = useState(null);
  const [expiry, setExpiry] = useState(EMPTY_EXPIRY);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!person) return toast.error('Pick who gets them');
    setBusy(true);
    try {
      const r = await client.post('distribution-batches/reassign', {
        item_ids: itemIds, recipient_id: person.id,
        reason: 'moved from the number report',
        ...expiryPayload(expiry),
      });
      if (r.data.assigned) toast.success(`${r.data.recalled} taken back · ${r.data.assigned} given to ${person.name}`);
      else toast.warning(r.data.note || 'Nothing could be moved');
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not move those numbers'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Users size={17} style={{ color: 'var(--color-primary-600)' }} />
          <div className="font-bold flex-1" style={{ color: 'var(--color-text)' }}>Give {count} number{count === 1 ? '' : 's'} to someone else</div>
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={17} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            They come off whoever is holding them now and go straight to the person you pick.
            A number someone already worked keeps its outcome and stays where it is.
          </div>
          <UserPicker value={person} onChange={setPerson} placeholder="Who gets them…" />
          {person && (
            <div className="text-xs rounded-lg p-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              → {person.name}{person.role ? ` · ${person.role}` : ''}{person.company_name ? ` · ${person.company_name}` : ''}
            </div>
          )}
          <ExpiryPicker value={expiry} onChange={setExpiry} />
        </div>
        <div className="p-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={go} disabled={busy || !person} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Move them
          </button>
        </div>
      </div>
    </div>
  );
}
