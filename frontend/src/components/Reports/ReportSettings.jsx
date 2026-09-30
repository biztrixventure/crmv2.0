import { useEffect, useMemo, useState } from 'react';
import Modal from '../UI/Modal';
import ThemedSelect from '../UI/Select';
import { Toggle, CheckRow, Loading, accent } from '../UI/kit';
import client from '../../api/client';
import { toast } from '../../utils/toast';
import { METRICS, METRIC_GROUPS, EARNER_METRICS, metricLabel } from '../../config/companyReportMetrics';

// ============================================================================
// ReportSettings -- superadmin knobs for Company Reports, stored in
// business_config `reports.company` (global, or overridden per company).
// Everything here changes what the report SHOWS; none of it changes what is
// counted -- that is the SQL's job and stays the same for every viewer.
// ============================================================================
const FALLBACK = { placeholder_users: [], earner_metric: 'sold', best_partner_min: 5, hidden_metrics: [], show_inactive: false };

export default function ReportSettings({ open, onClose, companyId, companyName, side, agents = [], onSaved }) {
  const [scope, setScope] = useState('global');
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setCfg(null);
    client.get('company-reports/config', { params: scope === 'company' && companyId ? { company_id: companyId } : {} })
      .then(r => { if (alive) setCfg(r.data.config || FALLBACK); })
      .catch(() => { if (alive) setCfg(FALLBACK); });
    return () => { alive = false; };
  }, [open, scope, companyId]);

  const people = useMemo(() => agents.filter(a => a.user_id).map(a => ({ id: a.user_id, name: a.name })), [agents]);
  const known = new Set(people.map(p => p.id));
  const otherPlaceholders = (cfg?.placeholder_users || []).filter(id => !known.has(id)).length;

  const set = (patch) => setCfg(c => ({ ...c, ...patch }));
  const toggleIn = (key, id, on) => setCfg(c => {
    const s = new Set(c[key] || []);
    if (on) s.add(id); else s.delete(id);
    return { ...c, [key]: [...s] };
  });

  const save = async () => {
    if (saving || !cfg) return;   // Modal actions carry no disabled state
    setSaving(true);
    try {
      await client.put('company-reports/config', { company_id: scope === 'company' ? companyId : undefined, config: cfg });
      toast.success(scope === 'company' ? `Saved for ${companyName}` : 'Saved for every company');
      onSaved?.();
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not save the settings.');
    } finally { setSaving(false); }
  };

  const label = (t) => <p className="text-xs font-bold uppercase tracking-wider m-0 mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t}</p>;

  return (
    <Modal isOpen={open} onClose={onClose} title="Report settings" size="2xl"
      actions={[
        { label: 'Cancel', onClick: onClose, variant: 'secondary' },
        { label: saving ? 'Saving…' : 'Save', onClick: save, variant: 'primary', disabled: saving || !cfg },
      ]}>
      {!cfg ? <Loading /> : (
        <div className="space-y-5">
          {companyId && (
            <div>
              {label('Applies to')}
              <ThemedSelect value={scope} onChange={e => setScope(e.target.value)} className="input">
                <option value="global">Every company (default)</option>
                <option value="company">Only {companyName}</option>
              </ThemedSelect>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label('Agents are ranked by')}
              <ThemedSelect value={cfg.earner_metric} onChange={e => set({ earner_metric: e.target.value })} className="input">
                {EARNER_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </ThemedSelect>
            </div>
            <div>
              {label('"Best rate" needs at least')}
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={500} value={cfg.best_partner_min}
                  onChange={e => set({ best_partner_min: e.target.value })}
                  className="input w-24" />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>transfers, so one lucky sale is not a "best"</span>
              </div>
            </div>
          </div>

          <Toggle checked={cfg.show_inactive} onChange={v => set({ show_inactive: v })}
            label="Show inactive members with no activity"
            hint="Off: an agent who left and did nothing in the range is left off the table. Anyone with activity always shows." />

          <div>
            {label('Placeholder accounts')}
            <p className="text-xs m-0 mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Logins that stand in for "no real agent" (e.g. sales punched to the company name before agents had logins).
              They stay in totals, are labelled, and are never ranked or picked as a best partner.
            </p>
            <div className="max-h-44 overflow-y-auto rounded-xl px-3 py-1" style={{ border: '1px solid var(--color-border)' }}>
              {people.length === 0 && <p className="text-xs m-0 py-2" style={{ color: 'var(--color-text-tertiary)' }}>Open a company report to pick from its agents.</p>}
              {people.map(p => (
                <CheckRow key={p.id} label={p.name} checked={(cfg.placeholder_users || []).includes(p.id)}
                  onChange={on => toggleIn('placeholder_users', p.id, on)} />
              ))}
            </div>
            {otherPlaceholders > 0 && (
              <p className="text-[11px] m-0 mt-1" style={{ color: accent('muted').fg }}>
                + {otherPlaceholders} placeholder account{otherPlaceholders === 1 ? '' : 's'} from other companies (kept).
              </p>
            )}
          </div>

          <div>
            {label('Metrics shown')}
            <p className="text-xs m-0 mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Unticked metrics disappear for everyone. Each viewer still picks their own columns from what is left.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {METRIC_GROUPS.map(g => (
                <div key={g.id}>
                  <p className="text-[11px] font-semibold m-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{g.label}</p>
                  {METRICS.filter(m => m.group === g.id).map(m => (
                    <CheckRow key={m.key} label={metricLabel(m, side || 'fronter')}
                      checked={!(cfg.hidden_metrics || []).includes(m.key)}
                      onChange={on => toggleIn('hidden_metrics', m.key, !on)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
