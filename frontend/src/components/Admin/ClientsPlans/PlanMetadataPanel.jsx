// PlanMetadataPanel — turn each plan (and optionally client) into a real product
// by attaching structured attributes (tier, coverage type, term, mileage,
// deductible, price, cost, notes). Purely additive: reads/writes sale_configs
// .metadata (mig 214) via the existing GET/PUT /sale-configs endpoints. The
// free-text sales.plan / sales.client_name contract is untouched.
import { useState, useEffect, useCallback } from 'react';
import { Package, Save, ChevronDown, ChevronRight, Info } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, EmptyState, PillTabs, Field, useFlash } from '../../UI/kit';

const PLAN_FIELDS = [
  { key: 'tier',          label: 'Tier',            type: 'text',   ph: 'Silver / Gold / Platinum' },
  { key: 'coverage_type', label: 'Coverage type',   type: 'select', opts: [['', '—'], ['vsc', 'Vehicle Service Contract'], ['manufacturer', 'Manufacturer warranty'], ['other', 'Other']] },
  { key: 'term_months',   label: 'Term (months)',   type: 'number', ph: 'e.g. 48' },
  { key: 'mileage_cap',   label: 'Mileage cap',     type: 'number', ph: 'e.g. 60000' },
  { key: 'deductible',    label: 'Deductible ($)',  type: 'number', ph: 'e.g. 100' },
  { key: 'price',         label: 'Sale price ($)',  type: 'number', ph: 'e.g. 1999' },
  { key: 'cost',          label: 'Cost ($)',        type: 'number', ph: 'e.g. 1200' },
  { key: 'notes',         label: 'Notes',           type: 'text',   ph: 'Anything worth recording' },
];
const CLIENT_FIELDS = [
  { key: 'underwriter', label: 'Underwriter', type: 'text', ph: 'Backing carrier / administrator' },
  { key: 'notes',       label: 'Notes',       type: 'text', ph: '' },
];

export default function PlanMetadataPanel() {
  const [kind, setKind]         = useState('plan');       // plan | client
  const [companyId, setCompanyId] = useState('');         // '' = global defaults only
  const [companies, setCompanies] = useState([]);
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const { msg, flash, clear }   = useFlash();

  useEffect(() => { client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { type: kind, includeHidden: 1 };
      if (companyId) params.company_id = companyId;
      const r = await client.get('sale-configs', { params });
      setRows(r.data.configs || []);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load.'); }
    finally { setLoading(false); }
  }, [kind, companyId, flash]);
  useEffect(() => { load(); }, [load]);

  const fields = kind === 'plan' ? PLAN_FIELDS : CLIENT_FIELDS;

  return (
    <div className="max-w-4xl">
      <SectionHeader
        icon={Package}
        title={`Plan details ${kind === 'client' ? '' : '(product attributes)'}`}
        subtitle="Optional — enriches each catalog entry. Nothing here changes what's stored on a sale; it just makes plans real products. Keep VSC vs manufacturer accurate (FTC)."
      />
      {msg && <div className="mb-3"><Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert></div>}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <PillTabs value={kind} onChange={setKind}
          items={[{ key: 'plan', label: 'Plans' }, { key: 'client', label: 'Clients' }]} />
        <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)} className="input w-56">
          <option value="">Global defaults</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </ThemedSelect>
      </div>

      {loading ? (
        <Loading variant="rows" rows={5} label="Loading catalog…" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Package} title={`No ${kind}s in this scope`} hint="Add them in the Clients & Plans tab first." />
      ) : (
        <div className="space-y-2">
          {rows.map(row => <MetaRow key={row.id} row={row} fields={fields} onSaved={() => flash('success', 'Saved.')} />)}
        </div>
      )}
    </div>
  );
}

function MetaRow({ row, fields, onSaved }) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState(row.metadata || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMeta(row.metadata || {}); }, [row.metadata]);

  const set = (key, val, isNum) => setMeta(m => ({ ...m, [key]: val === '' ? undefined : (isNum ? Number(val) : val) }));
  const save = async () => {
    setSaving(true);
    try {
      const clean = {};
      Object.entries(meta).forEach(([k, v]) => { if (v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) clean[k] = v; });
      await client.put(`sale-configs/${row.id}`, { metadata: Object.keys(clean).length ? clean : null });
      onSaved?.();
    } catch (e) { onSaved?.(); } finally { setSaving(false); }
  };

  const summary = [meta.tier, meta.coverage_type === 'vsc' ? 'VSC' : meta.coverage_type === 'manufacturer' ? 'Mfr' : null,
    meta.term_months ? `${meta.term_months}mo` : null, meta.mileage_cap ? `${meta.mileage_cap}mi` : null,
    meta.deductible != null ? `$${meta.deductible} ded` : null, meta.price != null ? `$${meta.price}` : null].filter(Boolean).join(' · ');

  return (
    <Panel tone="inset" radius="xl" pad="none">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="font-semibold text-text">{row.value}</span>
        {row.company_id
          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-info-500)', color: '#fff' }}>Company</span>
          : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>Global</span>}
        {row.hidden && <span className="text-[10px] text-text-tertiary">hidden</span>}
        <span className="ml-auto text-[11px] text-text-secondary truncate max-w-[45%]">{summary || 'no details set'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map(f => (
              <Field key={f.key} label={f.label}>
                {f.type === 'select' ? (
                  <ThemedSelect value={meta[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className="input w-full">
                    {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </ThemedSelect>
                ) : (
                  <input type={f.type === 'number' ? 'number' : 'text'} value={meta[f.key] ?? ''} placeholder={f.ph || ''}
                    onChange={e => set(f.key, e.target.value, f.type === 'number')} className="input w-full" />
                )}
              </Field>
            ))}
          </div>
          <button onClick={save} disabled={saving}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
            {saving ? <Loading variant="inline" size={14} /> : <Save size={14} />} Save details
          </button>
        </div>
      )}
    </Panel>
  );
}
