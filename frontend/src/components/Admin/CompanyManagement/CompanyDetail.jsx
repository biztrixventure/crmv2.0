import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Users, Shield, Send, DollarSign,
  Calendar, BarChart3, Search, RefreshCw,
} from 'lucide-react';
import { Card, Badge } from '../../UI';
import client from '../../../api/client';

const SALE_BADGE     = { open:'info', sold:'success', cancelled:'error', follow_up:'warning', closed_won:'success', closed_lost:'error', compliance_cancelled:'error', dispute:'warning', chargeback:'error' };
const TRANSFER_BADGE = { pending:'warning', assigned:'info', completed:'success', cancelled:'error', rejected:'error' };
const LIMIT = 50;

// ── small search table for transfers/sales/callbacks ─────────────────────────
const RecordsPanel = ({ companyId, type }) => {
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [page, setPage]       = useState(1);

  const SALE_STATUSES     = ['open','sold','cancelled','follow_up','closed_won','closed_lost','compliance_cancelled','dispute','chargeback'];
  const TRANSFER_STATUSES = ['pending','assigned','completed','cancelled','rejected'];
  const CALLBACK_STATUSES = ['pending','completed','cancelled','no_answer'];
  const statuses = type === 'sales' ? SALE_STATUSES : type === 'transfers' ? TRANSFER_STATUSES : CALLBACK_STATUSES;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await client.get(type, {
        params: { company_id: companyId, search: search || undefined, status: status || undefined, page: p, limit: LIMIT },
      });
      setRows(res.data[type] || res.data.transfers || res.data.callbacks || []);
      setTotal(res.data.total || 0);
      setPage(p);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [companyId, type, search, status]);

  useEffect(() => { load(1); }, [companyId, type]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(1)}
            placeholder="Search…" className="input pl-9 text-sm" />
        </div>
        <select value={status} onChange={e => { setStatus(e.target.value); }} className="input text-sm w-44">
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        <button onClick={() => load(1)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--gradient-sidebar)' }}>
          Search · {total}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-text-secondary py-8 text-sm">No records.</p>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            {type === 'sales' && (
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                  {['Customer','Phone','Reference','Vehicle','Monthly','Status','Date'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2.5 font-semibold text-text">{r.customer_name||'—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary text-xs">{r.customer_phone||'—'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-text-secondary">{r.reference_no||'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{[r.car_year,r.car_make,r.car_model].filter(Boolean).join(' ')||'—'}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-success-600">{r.monthly_payment?`$${r.monthly_payment}`:'—'}</td>
                      <td className="px-3 py-2.5"><Badge variant={SALE_BADGE[r.status]||'secondary'} size="sm">{r.status}</Badge></td>
                      <td className="px-3 py-2.5 text-xs text-text-tertiary">{new Date(r.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {type === 'transfers' && (
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                  {['Customer','Phone','Status','Rejection','Date'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2.5 font-semibold text-text">
                        {r.form_data?.FirstName ? `${r.form_data.FirstName} ${r.form_data.LastName||''}`.trim() : r.form_data?.customer_name||'—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{r.form_data?.Phone||r.form_data?.customer_phone||'—'}</td>
                      <td className="px-3 py-2.5"><Badge variant={TRANSFER_BADGE[r.status]||'secondary'} size="sm">{r.status}</Badge></td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{r.rejection_count>0?`${r.rejection_count}×`:'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-text-tertiary">{new Date(r.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {type === 'callbacks' && (
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                  {['Customer','Phone','Scheduled','Status'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2.5 font-semibold text-text">{r.customer_name||'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{r.customer_phone||'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{new Date(r.callback_at).toLocaleString()}</td>
                      <td className="px-3 py-2.5"><Badge variant={r.status==='pending'?'warning':r.status==='completed'?'success':'error'} size="sm">{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs text-text-secondary">{(page-1)*LIMIT+1}–{Math.min(page*LIMIT,total)} of {total}</span>
              <div className="flex gap-2">
                <button disabled={page===1} onClick={()=>load(page-1)} className="px-3 py-1 rounded text-xs font-semibold disabled:opacity-40" style={{color:'var(--color-text-secondary)'}}>Prev</button>
                <button disabled={page*LIMIT>=total} onClick={()=>load(page+1)} className="px-3 py-1 rounded text-xs font-semibold disabled:opacity-40" style={{color:'var(--color-text-secondary)'}}>Next</button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ── users panel ───────────────────────────────────────────────────────────────
const UsersPanel = ({ companyId }) => {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    client.get('users', { params: { company_id: companyId } })
      .then(r => setUsers(r.data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  if (!users.length) return <p className="text-center text-text-secondary py-8 text-sm">No users.</p>;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            {['Name','Email','Role','Level','Status'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2.5 font-semibold text-text">{[u.first_name,u.last_name].filter(Boolean).join(' ')||'—'}</td>
                <td className="px-3 py-2.5 text-xs text-text-secondary">{u.email||'—'}</td>
                <td className="px-3 py-2.5 text-xs text-text-secondary">{u.custom_roles?.name||'—'}</td>
                <td className="px-3 py-2.5 text-xs text-text-secondary">{u.custom_roles?.level||'—'}</td>
                <td className="px-3 py-2.5"><Badge variant={u.is_active?'success':'secondary'} size="sm">{u.is_active?'Active':'Inactive'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// ── roles panel ───────────────────────────────────────────────────────────────
const RolesPanel = ({ companyId }) => {
  const [roles, setRoles]     = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    client.get('roles', { params: { company_id: companyId } })
      .then(r => setRoles(r.data.roles || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  if (!roles.length) return <p className="text-center text-text-secondary py-8 text-sm">No roles.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {roles.map(r => (
        <Card key={r.id} className="p-4">
          <p className="font-semibold text-text mb-1">{r.name}</p>
          <p className="text-xs text-text-secondary mb-2 capitalize">{r.level?.replace(/_/g,' ')}</p>
          {r.description && <p className="text-xs text-text-tertiary mb-2">{r.description}</p>}
          <p className="text-xs text-text-tertiary">{(r.permissions||[]).length} permissions</p>
        </Card>
      ))}
    </div>
  );
};

// ── overview stats ────────────────────────────────────────────────────────────
const OverviewPanel = ({ companyId }) => {
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tr, sa, cb, us] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 1 } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1 } }),
        client.get('callbacks', { params: { company_id: companyId, limit: 1 } }),
        client.get('users',     { params: { company_id: companyId } }),
      ]);
      const totalT = tr.data.total || 0;
      const totalS = sa.data.total || 0;
      const totalC = cb.data.total || 0;
      const totalU = (us.data.users || []).length;
      const conv   = totalT > 0 ? Math.round((totalS / totalT) * 100) : 0;
      setStats({ totalT, totalS, totalC, totalU, conv });
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [companyId]);

  const cards = [
    { label: 'Transfers',   value: stats.totalT, color: 'info',    icon: Send        },
    { label: 'Sales',       value: stats.totalS, color: 'success', icon: DollarSign  },
    { label: 'Callbacks',   value: stats.totalC, color: 'warning', icon: Calendar    },
    { label: 'Users',       value: stats.totalU, color: 'primary', icon: Users       },
    { label: 'Conversion',  value: `${stats.conv||0}%`, color: 'secondary', icon: BarChart3 },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map(c => (
        <Card key={c.label} className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-text-secondary mb-1">{c.label}</p>
              <p className={`text-2xl font-bold text-${c.color}-600`}>
                {loading ? '—' : (c.value ?? 0)}
              </p>
            </div>
            <div className={`p-2 rounded-lg bg-${c.color}-100 dark:bg-${c.color}-900`}>
              <c.icon size={16} className={`text-${c.color}-600`} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

// ── main CompanyDetail ────────────────────────────────────────────────────────
const TABS = [
  { key: 'overview',   label: 'Overview',   icon: BarChart3  },
  { key: 'users',      label: 'Users',      icon: Users      },
  { key: 'roles',      label: 'Roles',      icon: Shield     },
  { key: 'transfers',  label: 'Transfers',  icon: Send       },
  { key: 'sales',      label: 'Sales',      icon: DollarSign },
  { key: 'callbacks',  label: 'Callbacks',  icon: Calendar   },
];

const CompanyDetail = ({ company, onBack }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [refresh, setRefresh]     = useState(0);

  return (
    <div>
      {/* back bar */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ArrowLeft size={16} /> Back to companies
        </button>
        <span style={{ color: 'var(--color-border)' }}>|</span>
        <h2 className="text-2xl font-bold text-text">{company.name}</h2>
        <Badge variant={company.is_active ? 'success' : 'secondary'} size="sm">
          {company.is_active ? 'Active' : 'Inactive'}
        </Badge>
        <button onClick={() => setRefresh(r => r + 1)} className="ml-auto p-2 rounded-lg hover:bg-bg-secondary transition-colors">
          <RefreshCw size={16} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-xl w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
            style={{
              backgroundColor: activeTab === t.key ? 'var(--color-surface)' : 'transparent',
              color:            activeTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
              boxShadow:        activeTab === t.key ? 'var(--shadow-sm)' : 'none',
            }}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* panels */}
      {activeTab === 'overview'  && <OverviewPanel  key={`ov-${refresh}`}  companyId={company.id} />}
      {activeTab === 'users'     && <UsersPanel     key={`us-${refresh}`}  companyId={company.id} />}
      {activeTab === 'roles'     && <RolesPanel     key={`ro-${refresh}`}  companyId={company.id} />}
      {activeTab === 'transfers' && <RecordsPanel   key={`tr-${refresh}`}  companyId={company.id} type="transfers" />}
      {activeTab === 'sales'     && <RecordsPanel   key={`sa-${refresh}`}  companyId={company.id} type="sales" />}
      {activeTab === 'callbacks' && <RecordsPanel   key={`cb-${refresh}`}  companyId={company.id} type="callbacks" />}
    </div>
  );
};

export default CompanyDetail;
