import { useState, useEffect, useCallback } from 'react';
import {
  Search, User, Phone, Mail, MapPin, Car, Shield, ArrowLeftRight,
  FileText, XCircle, ChevronLeft, Building2, UserCheck, Headphones, Briefcase,
} from 'lucide-react';
import client from '../../../api/client';

// ── helpers ────────────────────────────────────────────────────────────────
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const money   = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString()}`);

const STATUS_TONE = {
  closed_won: '#16a34a', open: '#2563eb', pending_review: '#d97706',
  needs_revision: '#dc2626', cancelled: '#dc2626',
};
const STATUS_LABEL = {
  closed_won: 'Approved', open: 'Open', pending_review: 'Pending Review',
  needs_revision: 'Needs Revision', cancelled: 'Cancelled',
};

const Pill = ({ children, color = '#6b7280' }) => (
  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
    style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}>{children}</span>
);

const StatCard = ({ label, value }) => (
  <div className="rounded-xl border p-3 text-center"
    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
    <div className="text-2xl font-extrabold" style={{ color: 'var(--color-text)' }}>{value}</div>
    <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
  </div>
);

const Section = ({ title, icon: Icon, count, children }) => (
  <div className="rounded-xl border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
    <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
      <Icon size={16} style={{ color: 'var(--color-text-secondary)' }} />
      <h3 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{title}</h3>
      {count != null && <Pill>{count}</Pill>}
    </div>
    <div className="p-2">{children}</div>
  </div>
);

const Empty = ({ children }) => (
  <p className="text-xs px-2 py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{children}</p>
);

const Row = ({ children }) => (
  <div className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg text-sm"
    style={{ color: 'var(--color-text)' }}>{children}</div>
);

const AgentCard = ({ agent, icon: Icon, role }) => {
  if (!agent) return (
    <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={14} /> {role}
      </div>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-tertiary)' }}>—</p>
    </div>
  );
  const s = agent.stats;
  return (
    <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={14} /> {role}
      </div>
      <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-text)' }}>{agent.name}</p>
      {s && (
        <div className="flex gap-3 mt-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span><b style={{ color: 'var(--color-text)' }}>{s.customers}</b> cust</span>
          <span><b style={{ color: 'var(--color-text)' }}>{s.transfers}</b> xfer</span>
          <span><b style={{ color: 'var(--color-text)' }}>{s.sales}</b> sales</span>
          <span><b style={{ color: 'var(--color-text)' }}>{s.cancellations}</b> canc</span>
        </div>
      )}
    </div>
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

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  useEffect(() => {
    let alive = true;
    client.get('customer-profile/search', { params: { q: debounced } })
      .then(r => { if (alive) setResults(r.data.results || []); })
      .catch(() => { if (alive) setResults([]); });
    return () => { alive = false; };
  }, [debounced]);

  const open = useCallback(async (uuid) => {
    setLoading(true); setErr('');
    try { const r = await client.get(`customer-profile/${uuid}`); setProfile(r.data); }
    catch (e) { setErr(e?.response?.data?.error || 'Failed to load profile'); }
    finally { setLoading(false); }
  }, []);

  // ── profile view ──
  if (profile) {
    const { identity, links, stats } = profile;
    return (
      <div className="space-y-4">
        <button onClick={() => setProfile(null)}
          className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-primary-600)' }}>
          <ChevronLeft size={16} /> Back to search
        </button>

        {/* identity header */}
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)' }}>
              <User size={22} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold" style={{ color: 'var(--color-text)' }}>{identity.name || 'Unknown customer'}</h2>
              <p className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{profile.customer_uuid}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {identity.phone   && <span className="flex items-center gap-1.5"><Phone size={13} />{identity.phone}</span>}
            {identity.phone_2 && <span className="flex items-center gap-1.5"><Phone size={13} />{identity.phone_2}</span>}
            {identity.email   && <span className="flex items-center gap-1.5"><Mail size={13} />{identity.email}</span>}
            {identity.address && <span className="flex items-center gap-1.5"><MapPin size={13} />{identity.address}</span>}
          </div>
        </div>

        {/* stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <StatCard label="Transfers" value={stats.transfers} />
          <StatCard label="Sales" value={stats.sales} />
          <StatCard label="Active" value={stats.active_policies} />
          <StatCard label="Cancelled" value={stats.cancellations} />
          <StatCard label="Vehicles" value={stats.vehicles} />
          <StatCard label="Companies" value={stats.companies} />
        </div>

        {/* links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AgentCard agent={links.fronter} icon={UserCheck} role="Fronter" />
          <AgentCard agent={links.closer}  icon={Headphones} role="Closer" />
          <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              <Briefcase size={14} /> Client
            </div>
            <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-text)' }}>{links.client?.name || '—'}</p>
            {links.client && <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>{links.client.policy_count} policies</p>}
          </div>
        </div>

        {/* vehicles + plans */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Vehicles" icon={Car} count={profile.vehicles.length}>
            {profile.vehicles.length === 0 ? <Empty>No vehicles</Empty> : profile.vehicles.map((v, i) => (
              <Row key={i}>
                <span className="font-semibold">{v.label}{v.vin && <span className="ml-2 text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{v.vin}</span>}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{v.miles ? `${Number(v.miles).toLocaleString()} mi · ` : ''}{v.plan_count} plan(s)</span>
              </Row>
            ))}
          </Section>

          <Section title="Warranty Plans" icon={Shield} count={profile.plans.length}>
            {profile.plans.length === 0 ? <Empty>No plans</Empty> : profile.plans.map((p, i) => (
              <Row key={i}>
                <span className="font-semibold">{p.name || 'Plan'} {p.active && <Pill color="#16a34a">active</Pill>}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{money(p.monthly_payment)}/mo · {fmtDate(p.sold_on)}</span>
              </Row>
            ))}
          </Section>
        </div>

        {/* sales + transfers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Sales History" icon={FileText} count={profile.sales.length}>
            {profile.sales.length === 0 ? <Empty>No sales</Empty> : profile.sales.map((s) => (
              <Row key={s.id}>
                <span className="min-w-0">
                  <span className="font-semibold">{s.plan || 'Sale'}</span>
                  {s.vehicle && <span className="ml-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.vehicle}</span>}
                  {s.is_resell && <span className="ml-2"><Pill color="#7c3aed">resell</Pill></span>}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <Pill color={STATUS_TONE[s.status] || '#6b7280'}>{STATUS_LABEL[s.status] || s.status}</Pill>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(s.sale_date)}</span>
                </span>
              </Row>
            ))}
          </Section>

          <Section title="Transfer History" icon={ArrowLeftRight} count={profile.transfers.length}>
            {profile.transfers.length === 0 ? <Empty>No transfers</Empty> : profile.transfers.map((t) => (
              <Row key={t.number}>
                <span className="min-w-0">
                  <span className="font-semibold capitalize">{t.status}</span>
                  {t.disposition && <span className="ml-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t.disposition}</span>}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {t.vendor_code && <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{t.vendor_code}</span>}
                  <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(t.created_at)}</span>
                </span>
              </Row>
            ))}
          </Section>
        </div>

        {/* cancellations */}
        <Section title="Cancellations" icon={XCircle} count={profile.cancellations.length}>
          {profile.cancellations.length === 0 ? <Empty>No cancellations</Empty> : profile.cancellations.map((c) => (
            <Row key={c.sale_id}>
              <span className="font-semibold">{c.plan || 'Policy'} {c.reference_no && <span className="ml-2 text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{c.reference_no}</span>}</span>
              <span className="flex items-center gap-2">
                {c.reason_key && <Pill color="#dc2626">{c.reason_key}</Pill>}
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(c.date)}</span>
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

      {err && <p className="text-sm text-red-600">{err}</p>}
      {loading && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>}

      <div className="space-y-2">
        {results.length === 0 && !loading && <Empty>No customers found</Empty>}
        {results.map((r) => (
          <button key={r.customer_uuid} onClick={() => open(r.customer_uuid)}
            className="w-full text-left p-3 rounded-xl border transition-all duration-150 hover:shadow-md flex items-center justify-between gap-3"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <span className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <User size={16} style={{ color: 'var(--color-text-secondary)' }} />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>{r.name}</span>
                <span className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.phone}</span>
              </span>
            </span>
            <span className="text-[11px] flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
              <Building2 size={12} /> {fmtDate(r.last_sale_date)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
