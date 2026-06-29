import { useState, useEffect, useCallback } from 'react';
import {
  Search, User, Phone, Mail, MapPin, Car, Shield, ArrowLeftRight,
  FileText, XCircle, ChevronLeft, Building2, UserCheck, Headphones, Briefcase,
  DollarSign, CalendarClock, Hash, RefreshCw, Star, SlidersHorizontal,
} from 'lucide-react';
import client from '../../../api/client';
import SaleStatusBadge from '../../UI/SaleStatusBadge';
import CopyableNumber from '../../UI/CopyableNumber';
import { fmtSaleDate, fmtDateTimeET } from '../../../utils/timezone';

// ── helpers ────────────────────────────────────────────────────────────────
const money = (n) =>
  (n == null || n === '' || isNaN(Number(n))) ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Styled hover tooltip. Inline by default; the dark bubble explains the value
// or reveals the full text on hover. Uses a named group so nested tips don't
// trigger each other.
const Tip = ({ text, children, className = '' }) => (
  <span className={`relative group/tip inline-flex items-center ${className}`}>
    {children}
    {text != null && text !== '' && (
      <span role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-[11px] font-medium leading-snug opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 shadow-lg"
        style={{ backgroundColor: 'var(--color-text)', color: 'var(--color-surface)', whiteSpace: 'normal', width: 'max-content', maxWidth: '220px', textAlign: 'center' }}>
        {text}
      </span>
    )}
  </span>
);

// ── customer-segment filters ────────────────────────────────────────────────
const SEGMENTS = [
  { key: 'all',            label: 'All' },
  { key: 'star',           label: '★ Star' },
  { key: 'loyal',          label: 'Loyal · 2+ policies' },
  { key: 'chased_no_sale', label: 'Chased · no sale' },
  { key: 'at_risk',        label: 'At-risk · cancels' },
  { key: 'reseller',       label: 'Resellers' },
  { key: 'one_and_done',   label: 'One policy' },
];
const SORTS = [
  { key: 'score',         label: '★ Best customers' },
  { key: 'activity',      label: 'Last activity' },
  { key: 'transfers',     label: 'Most transfers' },
  { key: 'policies',      label: 'Most policies' },
  { key: 'cancellations', label: 'Most cancellations' },
  { key: 'sales',         label: 'Most sales' },
];
const SEG_COLOR = {
  'Star': '#f59e0b', 'Loyal': '#10b981', 'Customer': '#10b981', 'Reseller': '#8b5cf6',
  'At-risk': '#ef4444', 'Lost': '#ef4444', 'Chased — no sale': '#f97316',
  'Past customer': '#6b7280', 'Lead': '#6b7280',
};

const Stars = ({ n = 0 }) => (
  <span className="inline-flex items-center" title={`${n}/5`}>
    {[1, 2, 3, 4, 5].map(i => (
      <Star key={i} size={11} style={{ color: i <= n ? '#f59e0b' : 'var(--color-border)' }}
        fill={i <= n ? '#f59e0b' : 'none'} />
    ))}
  </span>
);

const DateTip = ({ value, prefix = '' }) =>
  value
    ? <Tip text={fmtDateTimeET(value)} className="cursor-help">{prefix}{fmtSaleDate(value)}</Tip>
    : <span>—</span>;

const Pill = ({ children, color = '#6b7280', tip }) => (
  <Tip text={tip}>
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}>{children}</span>
  </Tip>
);

const StatCard = ({ label, value, tip }) => (
  <div className="relative group/tip rounded-xl border p-3 text-center cursor-help"
    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
    <div className="text-2xl font-extrabold" style={{ color: 'var(--color-text)' }}>{value}</div>
    <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
    {tip && (
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-[11px] font-medium leading-snug opacity-0 group-hover/tip:opacity-100 transition-opacity z-50 shadow-lg"
        style={{ backgroundColor: 'var(--color-text)', color: 'var(--color-surface)', whiteSpace: 'normal', width: 'max-content', maxWidth: '200px', textAlign: 'center' }}>{tip}</span>
    )}
  </div>
);

const Section = ({ title, icon: Icon, count, hint, children }) => (
  <div className="rounded-xl border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
    <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
      <Icon size={16} style={{ color: 'var(--color-text-secondary)' }} />
      <h3 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{title}</h3>
      {count != null && <Pill tip={hint}>{count}</Pill>}
    </div>
    <div className="p-2">{children}</div>
  </div>
);

const Empty = ({ children }) => (
  <p className="text-xs px-2 py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{children}</p>
);

const Row = ({ children }) => (
  <div className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg text-sm" style={{ color: 'var(--color-text)' }}>{children}</div>
);

const AgentCard = ({ agent, icon: Icon, role, roleKey, tip }) => {
  const [stats, setStats] = useState(agent?.stats || null);
  const [loading, setLoading] = useState(false);

  if (!agent) return (
    <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><Icon size={14} /> {role}</div>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-tertiary)' }}>—</p>
    </div>
  );

  const loadStats = async () => {
    if (stats || loading || !agent.user_id) return;
    setLoading(true);
    try {
      const r = await client.get(`customer-profile/agent/${agent.user_id}`, { params: { role: roleKey } });
      setStats(r.data?.stats || null);
    } catch { /* best-effort */ } finally { setLoading(false); }
  };

  return (
    <button type="button" onClick={loadStats}
      className="rounded-xl border p-3 text-left w-full transition-all duration-150 hover:shadow-md"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={14} /> <Tip text={tip} className="cursor-help">{role}</Tip>
      </div>
      <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-text)' }}>{agent.name}</p>
      {stats ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          <Tip text="Distinct customers this agent has worked"><b style={{ color: 'var(--color-text)' }}>{stats.customers}</b>&nbsp;cust</Tip>
          <Tip text="Transfers this agent created/handled"><b style={{ color: 'var(--color-text)' }}>{stats.transfers}</b>&nbsp;xfer</Tip>
          <Tip text="Sales credited to this agent"><b style={{ color: 'var(--color-text)' }}>{stats.sales}</b>&nbsp;sales</Tip>
          <Tip text="Of those sales, how many cancelled"><b style={{ color: 'var(--color-text)' }}>{stats.cancellations}</b>&nbsp;canc</Tip>
        </div>
      ) : (
        <p className="text-[11px] mt-2" style={{ color: 'var(--color-primary-600)' }}>{loading ? 'Loading…' : 'Click to load their stats'}</p>
      )}
    </button>
  );
};

// ── main ─────────────────────────────────────────────────────────────────────
export default function CustomerProfile() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [segment, setSegment] = useState('all');
  const [sort, setSort] = useState('score');

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  useEffect(() => {
    let alive = true;
    client.get('customer-profile/browse', { params: { q: debounced, segment, sort } })
      .then(r => { if (alive) setResults(r.data.results || []); })
      .catch(() => { if (alive) setResults([]); });
    return () => { alive = false; };
  }, [debounced, segment, sort]);

  const open = useCallback(async (uuid) => {
    setLoading(true); setErr('');
    try { const r = await client.get(`customer-profile/${uuid}`); setProfile(r.data); }
    catch (e) { setErr(e?.response?.data?.error || 'Failed to load profile'); }
    finally { setLoading(false); }
  }, []);

  // ── profile view ──
  if (profile) {
    const { identity, links, stats, financials = {}, activity = {}, companies = [] } = profile;
    return (
      <div className="space-y-4">
        <button onClick={() => setProfile(null)} className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-primary-600)' }}>
          <ChevronLeft size={16} /> Back to search
        </button>

        {/* identity header */}
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)' }}><User size={22} className="text-white" /></div>
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold" style={{ color: 'var(--color-text)' }}>{identity.name || 'Unknown customer'}</h2>
              <Tip text="Stable customer id — UUIDv5 of the normalized phone. Every sale & transfer links to it." className="cursor-help">
                <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{profile.customer_uuid}</span>
              </Tip>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {identity.phone && <span className="flex items-center gap-1.5"><Phone size={13} /><CopyableNumber value={identity.phone} /></span>}
            {identity.phone_2 && <span className="flex items-center gap-1.5"><Phone size={13} /><CopyableNumber value={identity.phone_2} /></span>}
            {identity.email && <span className="flex items-center gap-1.5"><Mail size={13} />{identity.email}</span>}
            {identity.address && <Tip text={identity.address} className="cursor-help max-w-full"><span className="flex items-center gap-1.5 truncate"><MapPin size={13} />{identity.address}</span></Tip>}
          </div>
          {(activity.first_seen || activity.last_activity) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              <span className="flex items-center gap-1.5"><CalendarClock size={12} /> Customer since <DateTip value={activity.first_seen} /></span>
              <span className="flex items-center gap-1.5"><RefreshCw size={12} /> Last activity <DateTip value={activity.last_activity} /></span>
              {companies.length > 0 && (
                <span className="flex items-center gap-1.5 flex-wrap">
                  <Building2 size={12} />
                  {companies.map(c => <Pill key={c.id} color="#2563eb" tip="Company this customer's policies belong to">{c.name || c.id.slice(0, 8)}</Pill>)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <StatCard label="Transfers" value={stats.transfers} tip="How many times this customer was transferred (lead hand-offs)" />
          <StatCard label="Sales" value={stats.sales} tip="Total policy sales ever made for this customer" />
          <StatCard label="Active" value={stats.active_policies} tip="Approved policies still in force (not superseded or cancelled)" />
          <StatCard label="Cancelled" value={stats.cancellations} tip="Policies that were cancelled or terminated" />
          <StatCard label="Vehicles" value={stats.vehicles} tip="Distinct cars on this customer's policies (by VIN)" />
          <StatCard label="Companies" value={stats.companies} tip="How many closer companies hold this customer's policies" />
        </div>

        {/* financials */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="relative group/tip rounded-xl border p-3 cursor-help" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}><DollarSign size={12} /> Down Payments</div>
            <div className="text-lg font-extrabold mt-0.5" style={{ color: 'var(--color-text)' }}>{money(financials.total_down_payment)}</div>
            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-[11px] opacity-0 group-hover/tip:opacity-100 transition z-50 shadow-lg" style={{ backgroundColor: 'var(--color-text)', color: 'var(--color-surface)', whiteSpace: 'normal', width: 'max-content', maxWidth: '200px' }}>Total upfront down payments across all this customer's sales</span>
          </div>
          <div className="relative group/tip rounded-xl border p-3 cursor-help" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}><RefreshCw size={12} /> Monthly Recurring</div>
            <div className="text-lg font-extrabold mt-0.5" style={{ color: 'var(--color-text)' }}>{money(financials.monthly_recurring)}<span className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>/mo</span></div>
            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-[11px] opacity-0 group-hover/tip:opacity-100 transition z-50 shadow-lg" style={{ backgroundColor: 'var(--color-text)', color: 'var(--color-surface)', whiteSpace: 'normal', width: 'max-content', maxWidth: '200px' }}>Monthly payments still recurring on active policies only</span>
          </div>
        </div>

        {/* links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AgentCard agent={links.fronter} icon={UserCheck} role="Fronter" roleKey="fronter" tip="The agent who generated the lead / created the transfer" />
          <AgentCard agent={links.closer} icon={Headphones} role="Closer" roleKey="closer" tip="The agent who worked the lead and made the sale" />
          <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              <Briefcase size={14} /> <Tip text="The client account this customer's policies belong to" className="cursor-help">Client</Tip>
            </div>
            <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-text)' }}>{links.client?.name || '—'}</p>
            {links.client && <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>{links.client.policy_count} policies</p>}
          </div>
        </div>

        {/* vehicles + plans */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Vehicles" icon={Car} count={profile.vehicles.length} hint="Distinct cars across this customer's policies">
            {profile.vehicles.length === 0 ? <Empty>No vehicles</Empty> : profile.vehicles.map((v, i) => (
              <Row key={i}>
                <span className="font-semibold flex items-center gap-2">
                  {v.label}
                  {v.vin && <Tip text={`VIN: ${v.vin}`} className="cursor-help"><span className="inline-flex items-center gap-0.5 text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}><Hash size={10} />{String(v.vin).slice(-6)}</span></Tip>}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{v.miles ? `${Number(v.miles).toLocaleString()} mi · ` : ''}{v.plan_count} plan(s)</span>
              </Row>
            ))}
          </Section>

          <Section title="Warranty Plans" icon={Shield} count={profile.plans.length} hint="Coverage the customer holds — one per sale">
            {profile.plans.length === 0 ? <Empty>No plans</Empty> : profile.plans.map((p, i) => (
              <Row key={i}>
                <span className="font-semibold flex items-center gap-2">{p.name || 'Plan'} {p.active && <Pill color="#16a34a" tip="Approved & in force (not superseded or cancelled)">active</Pill>}</span>
                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <Tip text="Monthly payment on this plan" className="cursor-help">{money(p.monthly_payment)}/mo</Tip> · <DateTip value={p.sold_on} />
                </span>
              </Row>
            ))}
          </Section>
        </div>

        {/* sales + transfers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Sales History" icon={FileText} count={profile.sales.length} hint="Every policy sale ever made for this customer">
            {profile.sales.length === 0 ? <Empty>No sales</Empty> : profile.sales.map((s) => (
              <Row key={s.id}>
                <span className="min-w-0 flex items-center gap-2">
                  <span className="font-semibold">{s.plan || 'Sale'}</span>
                  {s.vehicle && <span className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{s.vehicle}</span>}
                  {s.reference_no && <Tip text={`Reference: ${s.reference_no}`} className="cursor-help"><Hash size={11} style={{ color: 'var(--color-text-tertiary)' }} /></Tip>}
                  {s.is_resell && <Pill color="#7c3aed" tip="A resell / renewal of an earlier policy">resell</Pill>}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <SaleStatusBadge sale={{ status: s.status, cancellation_date: s.cancellation_date }} />
                  <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}><DateTip value={s.sale_date} /></span>
                </span>
              </Row>
            ))}
          </Section>

          <Section title="Transfer History" icon={ArrowLeftRight} count={profile.transfers.length} hint="How many times this customer was transferred, with details">
            {profile.transfers.length === 0 ? <Empty>No transfers</Empty> : profile.transfers.map((t) => (
              <Row key={t.number}>
                <span className="min-w-0 flex items-center gap-2">
                  <span className="font-semibold capitalize">{t.status}</span>
                  {t.disposition && <Tip text="Disposition set on the dialer / by the closer" className="cursor-help"><span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t.disposition}</span></Tip>}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {t.vendor_code && <Tip text="VICIdial vendor/lead code for this transfer" className="cursor-help"><span className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{t.vendor_code}</span></Tip>}
                  <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}><DateTip value={t.created_at} /></span>
                </span>
              </Row>
            ))}
          </Section>
        </div>

        {/* cancellations */}
        <Section title="Cancellations" icon={XCircle} count={profile.cancellations.length} hint="Policies that cancelled, with reason & date">
          {profile.cancellations.length === 0 ? <Empty>No cancellations</Empty> : profile.cancellations.map((c) => (
            <Row key={c.sale_id}>
              <span className="font-semibold flex items-center gap-2">{c.plan || 'Policy'} {c.reference_no && <Tip text={`Reference: ${c.reference_no}`} className="cursor-help"><span className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{c.reference_no}</span></Tip>}</span>
              <span className="flex items-center gap-2">
                {c.reason_key && <Pill color="#dc2626" tip="Recorded cancellation reason">{c.reason_key}</Pill>}
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}><DateTip value={c.date} /></span>
              </span>
            </Row>
          ))}
        </Section>
      </div>
    );
  }

  // ── search view ──
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>Customer Profiles</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          The customer is the central object — every vehicle, plan, transfer, sale, and cancellation links back to them.
        </p>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by phone or name…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border text-sm"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
      </div>

      {/* ── Segment filters + sort ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SEGMENTS.map(s => {
            const on = segment === s.key;
            return (
              <button key={s.key} type="button" onClick={() => setSegment(s.key)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all"
                style={{
                  borderColor: on ? 'var(--color-primary-500)' : 'var(--color-border)',
                  background:  on ? 'var(--color-primary-500)' : 'var(--color-surface)',
                  color:       on ? '#fff' : 'var(--color-text-secondary)',
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <SlidersHorizontal size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="text-xs font-semibold rounded-lg border px-2 py-1.5"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {loading && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>}

      <div className="space-y-2">
        {results.length === 0 && !loading && <Empty>No customers match these filters</Empty>}
        {results.map((r) => {
          const segColor = SEG_COLOR[r.segment_label] || '#6b7280';
          return (
            <button key={r.customer_uuid} onClick={() => open(r.customer_uuid)}
              className="w-full text-left p-3 rounded-xl border transition-all duration-150 hover:shadow-md flex items-center justify-between gap-3"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                  <User size={16} style={{ color: 'var(--color-text-secondary)' }} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>{r.name || '—'}</span>
                    {r.segment_label && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
                        style={{ backgroundColor: `${segColor}22`, color: segColor, border: `1px solid ${segColor}44` }}>
                        {r.segment_label}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>{r.phone || '—'}</span>
                  {/* counts */}
                  <span className="flex items-center gap-2.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    <Tip text="Active policies" className="cursor-help"><span className="inline-flex items-center gap-0.5"><Shield size={11} /> {r.active_policies ?? 0}</span></Tip>
                    <Tip text="Transfers (times chased)" className="cursor-help"><span className="inline-flex items-center gap-0.5"><ArrowLeftRight size={11} /> {r.transfers_total ?? 0}</span></Tip>
                    <Tip text="Cancellations" className="cursor-help"><span className="inline-flex items-center gap-0.5"><XCircle size={11} /> {r.cancellations ?? 0}</span></Tip>
                    {(r.resells ?? 0) > 0 && <Tip text="Resells" className="cursor-help"><span className="inline-flex items-center gap-0.5"><RefreshCw size={11} /> {r.resells}</span></Tip>}
                  </span>
                </span>
              </span>
              <span className="flex flex-col items-end gap-1 flex-shrink-0">
                {r.stars != null && <Stars n={r.stars} />}
                <Tip text="Last activity" className="cursor-help">
                  <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    <CalendarClock size={12} /> {r.last_activity ? fmtSaleDate(r.last_activity) : (r.last_sale_date ? fmtSaleDate(r.last_sale_date) : '—')}
                  </span>
                </Tip>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
