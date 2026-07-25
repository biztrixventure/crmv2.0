// EgressSection — per-user data-egress limits: numeric caps (rows/exports per
// day, recording minutes) + the export button on/off, global or per data area.
// Reads GET /egress/limits + /egress/export-access (filtered to this user) and
// writes through the existing PUT /egress/limits + /egress/export-access.
import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, Save } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';

const pretty = (s) => String(s || '').replace(/[._]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
const numOrBlank = (v) => (v == null ? '' : String(v));

export default function EgressSection({ account }) {
  const userId = account.user_id;
  const [caps, setCaps]       = useState({ max_rows_per_export: '', max_exports_per_day: '', max_recording_minutes_per_day: '' });
  const [blocked, setBlocked] = useState({});   // { __global:bool, <area>:bool }
  const [areas, setAreas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [msg, setMsg]         = useState(null);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [limRes, accRes] = await Promise.all([
        client.get('egress/limits'),
        client.get('egress/export-access'),
      ]);
      const mine = (limRes.data.limits || []).filter(r => r.scope_type === 'user' && r.scope_id === userId);
      const csv  = mine.find(r => r.action_type === 'csv_export' && r.dataset == null);
      const rec  = mine.find(r => r.action_type === 'recording_listen' && r.dataset == null);
      setCaps({
        max_rows_per_export:           numOrBlank(csv?.max_rows_per_export),
        max_exports_per_day:           numOrBlank(csv?.max_exports_per_day),
        max_recording_minutes_per_day: numOrBlank(rec?.max_recording_minutes_per_day),
      });
      const acc = (accRes.data.access || []).find(a => a.scope_type === 'user' && a.scope_id === userId);
      setBlocked(acc?.blocked || {});
      setAreas(accRes.data.areas || []);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load egress config.'); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const saveCaps = async () => {
    setBusy('caps');
    try {
      await client.put('egress/limits', {
        scope_type: 'user', scope_id: userId, action_type: 'csv_export', dataset: '__all',
        max_rows_per_export: caps.max_rows_per_export, max_exports_per_day: caps.max_exports_per_day,
      });
      await client.put('egress/limits', {
        scope_type: 'user', scope_id: userId, action_type: 'recording_listen', dataset: '__all',
        max_recording_minutes_per_day: caps.max_recording_minutes_per_day,
      });
      flash('success', 'Limits saved.');
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); }
    finally { setBusy(null); }
  };

  const setBlock = async (dataset, isBlocked) => {
    setBusy('access:' + dataset);
    try {
      await client.put('egress/export-access', { scope_type: 'user', scope_id: userId, dataset, blocked: isBlocked });
      setBlocked(b => ({ ...b, [dataset]: isBlocked }));
      flash('success', 'Export access saved.');
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2"><Download size={16} style={{ color: 'var(--color-primary-600)' }} /><h3 className="text-sm font-bold text-text">Data egress limits</h3></div>
      {msg && <Alert type={msg.type}>{msg.text}</Alert>}

      {/* Numeric caps */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Daily caps (blank = no limit)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumField label="Rows per export" value={caps.max_rows_per_export} onChange={v => setCaps(c => ({ ...c, max_rows_per_export: v }))} />
          <NumField label="Exports per day" value={caps.max_exports_per_day} onChange={v => setCaps(c => ({ ...c, max_exports_per_day: v }))} />
          <NumField label="Recording min / day" value={caps.max_recording_minutes_per_day} onChange={v => setCaps(c => ({ ...c, max_recording_minutes_per_day: v }))} />
        </div>
        <button onClick={saveCaps} disabled={busy === 'caps'}
          className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
          {busy === 'caps' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save caps
        </button>
      </div>

      {/* Export access */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Export button — blocked when checked</h4>
        <label className="flex items-center gap-2 cursor-pointer text-sm py-1 font-semibold">
          <input type="checkbox" checked={!!blocked.__global} onChange={e => setBlock('__global', e.target.checked)} className="accent-[var(--color-error-600)]" />
          <span className="text-text">Block ALL exports (global)</span>
          {busy === 'access:__global' && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} />}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mt-2 pl-1">
          {areas.map(a => (
            <label key={a} className="flex items-center gap-2 cursor-pointer text-sm py-1">
              <input type="checkbox" checked={!!blocked[a]} onChange={e => setBlock(a, e.target.checked)} className="accent-[var(--color-error-600)]" />
              <span className="text-text">{pretty(a)}</span>
              {busy === 'access:' + a && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} />}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block mb-1">{label}</span>
      <input type="number" min="0" value={value} onChange={e => onChange(e.target.value)} placeholder="—" className="input w-full" />
    </label>
  );
}
