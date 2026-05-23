import { useState } from 'react';
import { toast } from 'sonner';
import { Layers, ChevronDown, Search, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '../../UI';

const fmt = (s) => s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

// Superadmin cleanup for duplicate transfers (same company + fronter + phone =
// the same lead entered twice). Full control: choose the keeper per group, opt
// each group in/out, then merge — children (sales, dispositions, …) reassign to
// the keeper before the duplicates are deleted.
const DuplicateTransferManager = ({ duplicates, loadDuplicates, mergeDuplicates }) => {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keep, setKeep] = useState({});       // groupKey -> transferId to keep
  const [include, setInclude] = useState({});  // groupKey -> bool
  const [merging, setMerging] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = async () => {
    setLoading(true);
    await loadDuplicates();
    setLoaded(true);
    setLoading(false);
  };

  const toggleOpen = () => {
    const next = !open; setOpen(next);
    if (next && !loaded) load();
  };

  const keeperOf = (g) => keep[g.key] || g.recommended_keep_id;
  const selectedGroups = (duplicates || []).filter(g => include[g.key]);
  const totalToRemove = selectedGroups.reduce((n, g) => n + (g.transfers.length - 1), 0);

  const runMerge = async () => {
    setConfirm(false);
    const merges = selectedGroups.map(g => ({
      keep_id: keeperOf(g),
      remove_ids: g.transfers.map(t => t.id).filter(id => id !== keeperOf(g)),
    }));
    if (!merges.length) { toast.warning('Select at least one group to merge.'); return; }
    setMerging(true);
    try {
      const res = await mergeDuplicates(merges);
      toast.success(`Merged ${res.groups_merged} group(s) — removed ${res.transfers_removed} duplicate(s), kept ${res.sales_reassigned} linked sale(s).`);
      setInclude({}); setKeep({});
    } catch (e) {
      toast.error(e.response?.data?.error || 'Merge failed.');
    } finally { setMerging(false); }
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={toggleOpen} className="w-full flex items-center justify-between p-4">
        <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--color-text)' }}>
          <Layers size={16} style={{ color: 'var(--color-primary-600)' }} /> Duplicate transfers
          {loaded && <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>({duplicates.length} group{duplicates.length !== 1 ? 's' : ''})</span>}
        </span>
        <ChevronDown size={16} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Same company + fronter + phone transferred more than once — usually the same lead entered twice.
            Pick which transfer to keep; merging reassigns its sales/dispositions to the keeper, then deletes the rest.
          </p>

          {!loaded || loading ? (
            <div className="flex items-center gap-2 justify-center py-6">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
              <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Scanning transfers…</span>
            </div>
          ) : duplicates.length === 0 ? (
            <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--color-success-600)' }}>
              <ShieldCheck size={18} /> <span className="text-sm">No duplicate transfers found.</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="secondary" onClick={load} className="flex items-center gap-1.5"><Search size={13} /> Re-scan</Button>
                <Button size="sm" variant="secondary" onClick={() => { const inc = {}; duplicates.forEach(g => { inc[g.key] = true; }); setInclude(inc); }}>Select all</Button>
                <Button size="sm" variant="secondary" onClick={() => setInclude({})}>Clear</Button>
                <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                  {selectedGroups.length} group(s) → remove {totalToRemove} duplicate(s)
                </span>
              </div>

              <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                {duplicates.map(g => {
                  const sel = !!include[g.key];
                  return (
                    <div key={g.key} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: `1px solid ${sel ? 'var(--color-primary-300)' : 'var(--color-border)'}` }}>
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input type="checkbox" checked={sel} onChange={() => setInclude(p => ({ ...p, [g.key]: !p[g.key] }))} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{g.company_name}</span>
                        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>· {g.fronter_name} · {g.phone} · {g.transfers.length} transfers</span>
                      </label>
                      <div className="space-y-1 pl-6">
                        {g.transfers.map(t => {
                          const isKeeper = keeperOf(g) === t.id;
                          return (
                            <label key={t.id} className="flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1"
                              style={{ backgroundColor: isKeeper ? 'rgba(34,197,94,0.10)' : 'transparent' }}>
                              <input type="radio" name={`keep-${g.key}`} checked={isKeeper} onChange={() => setKeep(p => ({ ...p, [g.key]: t.id }))} />
                              <span style={{ color: 'var(--color-text)', fontWeight: isKeeper ? 700 : 400 }}>{isKeeper ? 'KEEP' : 'remove'}</span>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{fmt(t.created_at)} · {t.status} · {t.customer} · {t.car}</span>
                              {t.sales_count > 0 && <span className="px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: '#2563eb', color: 'white' }}>{t.sales_count} sale{t.sales_count !== 1 ? 's' : ''}</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalToRemove > 0 && (
                <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: '#d97706' }}>
                    <AlertTriangle size={13} /> Merging deletes the unkept transfers. Linked sales move to the keeper first.
                  </span>
                  <Button variant="danger" disabled={merging} onClick={() => setConfirm(true)}>
                    {merging ? 'Merging…' : `Merge ${selectedGroups.length} group(s)`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Merge duplicate transfers?</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              This will remove <strong>{totalToRemove}</strong> duplicate transfer(s) across <strong>{selectedGroups.length}</strong> group(s).
              Sales and dispositions are reassigned to the kept transfer first. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConfirm(false)} className="flex-1">Cancel</Button>
              <Button variant="danger" onClick={runMerge} className="flex-1">Merge now</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuplicateTransferManager;
