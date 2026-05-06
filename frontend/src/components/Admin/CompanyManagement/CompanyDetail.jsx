import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  ArrowLeft, Users, Shield, Send, DollarSign, Building2,
  Calendar, BarChart3, Search, RefreshCw, Settings, Download, Upload,
  PlusCircle, Trash2, CheckCircle, XCircle, Link, LinkIcon, Unlink, Edit2, Hash, Phone,
  AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';
import { Card, Badge, Button } from '../../UI';
import Modal from '../../UI/Modal';
import RoleModal from '../RoleManagement/RoleModal';
import CreateUserModal from '../UserManagement/CreateUserModal';
import BulkUploadModal from '../UserManagement/BulkUploadModal';
import UserModal from '../UserManagement/UserModal';
import client from '../../../api/client';
import SaleDetailDrawer              from '../../Shared/SaleDetailDrawer';
import TransferDetailDrawer          from '../../Shared/TransferDetailDrawer';
import CallbackDetailDrawer          from '../../Shared/CallbackDetailDrawer';
import UserDetailDrawer              from '../../Shared/UserDetailDrawer';
import CallbackNumberDetailDrawer    from '../../Shared/CallbackNumberDetailDrawer';
import CallbackPhoneHistoryDrawer    from '../../Shared/CallbackPhoneHistoryDrawer';

// ── constants ─────────────────────────────────────────────────────────────────
const SALE_BADGE     = { open:'info', sold:'success', cancelled:'error', follow_up:'warning', closed_won:'success', closed_lost:'error', compliance_cancelled:'error', dispute:'warning', chargeback:'error' };
const TRANSFER_BADGE = { pending:'warning', assigned:'info', completed:'success', cancelled:'error', rejected:'error' };
const LIMIT = 50;
const SALE_STATUSES     = ['open','sold','cancelled','follow_up','closed_won','closed_lost','compliance_cancelled','dispute','chargeback'];
const TRANSFER_STATUSES = ['pending','assigned','completed','cancelled','rejected'];
const CALLBACK_STATUSES = ['pending','completed','cancelled','no_answer','answering_machine'];

const PRIORITY_CFG = {
  High:   { dot: '#ef4444', bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  Medium: { dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
  Low:    { dot: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' },
};
const SORT_PRIORITY = { High: 3, Medium: 2, Low: 1 };

const PriorityBadge = ({ priority }) => {
  if (!priority) return <span className="text-xs text-text-secondary">—</span>;
  const cfg = PRIORITY_CFG[priority] || PRIORITY_CFG.Medium;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-xs font-semibold border"
      style={{ backgroundColor: cfg.bg, color: cfg.text, borderColor: cfg.border }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {priority}
    </span>
  );
};

const downloadCSV = (rows, headers, filename) => {
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
};

const SortTh = ({ col, sort, onSort, children }) => {
  const Icon = sort.col !== col ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th onClick={() => onSort(col)}
      className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase cursor-pointer select-none whitespace-nowrap hover:text-text transition-colors">
      <span className="inline-flex items-center gap-1">{children}<Icon size={10} className="opacity-50" /></span>
    </th>
  );
};

// ── RecordsPanel ──────────────────────────────────────────────────────────────
const RecordsPanel = ({ companyId, type }) => {
  const [rows, setRows]               = useState([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState('');
  const [status, setStatus]           = useState('');
  const [priority, setPriority]       = useState('');
  const [userFilter, setUserFilter]   = useState('');
  const [companyUsers, setCompanyUsers] = useState([]);
  const [sort, setSort]               = useState({ col: type === 'callbacks' ? 'callback_at' : 'created_at', dir: 'asc' });
  const [page, setPage]               = useState(1);
  const [selected, setSelected]         = useState(null);
  const [phoneDrawer, setPhoneDrawer]   = useState(null);
  const [exportLoading, setExportLoading] = useState(false);

  const statuses = type === 'sales' ? SALE_STATUSES : type === 'transfers' ? TRANSFER_STATUSES : CALLBACK_STATUSES;

  // Fetch users for this company (for callbacks agent filter)
  useEffect(() => {
    if (type !== 'callbacks') return;
    client.get('users', { params: { company_id: companyId } })
      .then(r => setCompanyUsers(r.data.users || []))
      .catch(() => {});
  }, [companyId, type]);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = {
        company_id: companyId,
        search: search || undefined,
        status: status || undefined,
        page: p, limit: LIMIT,
      };
      if (type === 'callbacks') {
        if (priority)   params.priority = priority;
        if (userFilter) params.user_id  = userFilter;
      }
      const res = await client.get(type, { params });
      setRows(res.data[type] || res.data.transfers || res.data.callbacks || []);
      setTotal(res.data.total || 0);
      setPage(p);
    } catch { } finally { setLoading(false); }
  }, [companyId, type, search, status, priority, userFilter]);

  useEffect(() => { load(1); }, [companyId, type]);

  const handleExport = async () => {
    setExportLoading(true);
    const today = new Date().toISOString().split('T')[0];
    try {
      const params = { company_id: companyId, status: status || undefined, limit: 5000, page: 1 };
      if (type === 'callbacks') {
        if (priority)   params.priority = priority;
        if (userFilter) params.user_id  = userFilter;
      }
      const res = await client.get(type, { params });
      const data = res.data[type] || res.data.transfers || res.data.callbacks || [];

      if (type === 'sales') {
        const rows = data.map(s => [
          s.customer_name||'', s.customer_phone||'', s.reference_no||'',
          s.status||'', s.plan||'',
          s.monthly_payment ? `$${s.monthly_payment}` : '',
          new Date(s.created_at).toLocaleDateString(),
        ]);
        downloadCSV(rows, ['Customer','Phone','Reference','Status','Plan','Monthly','Created'],
          `${type}_${companyId}_${today}.csv`);
      } else if (type === 'transfers') {
        const rows = data.map(t => {
          const fd = t.form_data || {};
          const name = fd.customer_name || (fd.FirstName ? `${fd.FirstName} ${fd.LastName||''}`.trim() : '') || '';
          return [name, fd.Phone||fd.customer_phone||'', t.status||'', new Date(t.created_at).toLocaleDateString()];
        });
        downloadCSV(rows, ['Customer','Phone','Status','Created'],
          `transfers_${companyId}_${today}.csv`);
      } else {
        const rows = data.map(cb => [
          cb.customer_name||'', cb.customer_phone||'', cb.priority||'',
          cb.user_name||'', cb.status||'',
          cb.callback_at ? new Date(cb.callback_at).toLocaleString() : '',
        ]);
        downloadCSV(rows, ['Customer','Phone','Priority','Agent','Status','Scheduled'],
          `callbacks_${companyId}_${today}.csv`);
      }
    } catch { /* silent */ } finally { setExportLoading(false); }
  };

  const toggleSort = (col) =>
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });

  const sorted = useMemo(() => {
    if (type !== 'callbacks') return rows;
    return [...rows].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      switch (sort.col) {
        case 'priority':    return ((SORT_PRIORITY[b.priority]||0) - (SORT_PRIORITY[a.priority]||0)) * dir;
        case 'callback_at': return (a.callback_at||'').localeCompare(b.callback_at||'') * dir;
        case 'customer':    return (a.customer_name||'').localeCompare(b.customer_name||'') * dir;
        case 'status':      return (a.status||'').localeCompare(b.status||'') * dir;
        case 'agent':       return (a.user_name||'').localeCompare(b.user_name||'') * dir;
        default: return 0;
      }
    });
  }, [rows, sort, type]);

  const displayRows = type === 'callbacks' ? sorted : rows;

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(1)}
            placeholder="Search…" className="input pl-9 text-sm" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="input text-sm w-40">
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        {type === 'callbacks' && <>
          <select value={priority} onChange={e => setPriority(e.target.value)} className="input text-sm w-36">
            <option value="">All priorities</option>
            <option value="High">🔴 High</option>
            <option value="Medium">🟡 Medium</option>
            <option value="Low">🔵 Low</option>
          </select>
          <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className="input text-sm w-40">
            <option value="">All agents</option>
            {companyUsers.map(u => (
              <option key={u.id} value={u.user_id}>
                {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email}
              </option>
            ))}
          </select>
        </>}
        <button onClick={() => load(1)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--gradient-sidebar)' }}>
          Search · {total}
        </button>
        {total > 0 && (
          <button onClick={handleExport} disabled={exportLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
            <Download size={13} />
            {exportLoading ? 'Exporting…' : 'Export CSV'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
      ) : displayRows.length === 0 ? (
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
                  {displayRows.map(r => (
                    <tr key={r.id} onClick={() => setSelected(r)}
                      className="hover:bg-bg-secondary cursor-pointer transition-colors"
                      style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2.5 font-semibold text-text">{r.customer_name||'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{r.customer_phone||'—'}</td>
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
                  {['Customer','Phone','Status','Rejections','Date'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {displayRows.map(r => (
                    <tr key={r.id} onClick={() => setSelected(r)}
                      className="hover:bg-bg-secondary cursor-pointer transition-colors"
                      style={{ borderBottom: '1px solid var(--color-border)' }}>
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
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                    <SortTh col="customer"    sort={sort} onSort={toggleSort}>Customer</SortTh>
                    <SortTh col="priority"    sort={sort} onSort={toggleSort}>Priority</SortTh>
                    <SortTh col="agent"       sort={sort} onSort={toggleSort}>Agent</SortTh>
                    <SortTh col="callback_at" sort={sort} onSort={toggleSort}>Scheduled</SortTh>
                    <SortTh col="status"      sort={sort} onSort={toggleSort}>Status</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => {
                    const isOverdue = r.status === 'pending' && r.callback_at && new Date(r.callback_at) < new Date();
                    return (
                      <tr key={r.id} onClick={() => setSelected(r)}
                        className="hover:bg-bg-secondary cursor-pointer transition-colors"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-text text-sm">{r.customer_name||'—'}</p>
                          {r.customer_phone ? (
                            <button onClick={e => { e.stopPropagation(); setPhoneDrawer({ phone: r.customer_phone, customerName: r.customer_name }); }}
                              className="text-xs font-mono hover:underline"
                              style={{ color: 'var(--color-primary-600)' }}>
                              {r.customer_phone}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5"><PriorityBadge priority={r.priority} /></td>
                        <td className="px-3 py-2.5 text-xs text-text-secondary">{r.user_name || '—'}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <div className="flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                            {new Date(r.callback_at).toLocaleString()}
                            {isOverdue && (
                              <span title="Overdue" className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-semibold"
                                style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                                <AlertCircle size={9} /> OD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={r.status==='pending'?'warning':r.status==='completed'?'success':'error'} size="sm">
                            {r.status?.replace(/_/g,' ')}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
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

      {/* Detail drawers */}
      {type === 'sales'     && <SaleDetailDrawer     sale={selected}     onClose={() => setSelected(null)} />}
      {type === 'transfers' && <TransferDetailDrawer transfer={selected} onClose={() => setSelected(null)} />}
      {type === 'callbacks' && <CallbackDetailDrawer callback={selected} onClose={() => setSelected(null)} />}
      {phoneDrawer && (
        <CallbackPhoneHistoryDrawer
          phone={phoneDrawer.phone}
          customerName={phoneDrawer.customerName}
          onClose={() => setPhoneDrawer(null)}
        />
      )}
    </div>
  );
};

// ── OverviewPanel ─────────────────────────────────────────────────────────────
const OverviewPanel = ({ companyId }) => {
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      client.get('transfers', { params: { company_id: companyId, limit: 1 } }),
      client.get('sales',     { params: { company_id: companyId, limit: 1 } }),
      client.get('callbacks', { params: { company_id: companyId, limit: 1 } }),
      client.get('users',     { params: { company_id: companyId } }),
    ]).then(([tr, sa, cb, us]) => {
      const totalT = tr.data.total || 0;
      const totalS = sa.data.total || 0;
      const conv   = totalT > 0 ? Math.round((totalS / totalT) * 100) : 0;
      setStats({ totalT, totalS, totalC: cb.data.total || 0, totalU: (us.data.users||[]).length, conv });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [companyId]);

  const cards = [
    { label: 'Transfers',  value: stats.totalT, color: 'info',    icon: Send       },
    { label: 'Sales',      value: stats.totalS, color: 'success', icon: DollarSign },
    { label: 'Callbacks',  value: stats.totalC, color: 'warning', icon: Calendar   },
    { label: 'Members',    value: stats.totalU, color: 'primary', icon: Users      },
    { label: 'Conversion', value: `${stats.conv||0}%`, color: 'secondary', icon: BarChart3 },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map(c => (
        <Card key={c.label} className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-text-secondary mb-1">{c.label}</p>
              <p className={`text-2xl font-bold text-${c.color}-600`}>{loading ? '—' : (c.value ?? 0)}</p>
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

// ── MembersPanel ──────────────────────────────────────────────────────────────
const MembersPanel = ({ companyId }) => {
  const { hasPermission } = useAuth();
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [showCreate, setShowCreate]   = useState(false);
  const [showBulk,   setShowBulk]     = useState(false);
  const [editUser, setEditUser]       = useState(null);
  const [viewUser, setViewUser]       = useState(null);
  const [actionErr, setActionErr]     = useState('');
  const [confirm, setConfirm]         = useState(null); // { id, name, action: 'delete'|'deactivate' }
  const [exportLoading, setExportLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client.get('users', { params: { company_id: companyId } })
      .then(r => setUsers(r.data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [companyId]);

  const toggleActive = async (u) => {
    setActionErr('');
    try {
      await client.put(`users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (err) {
      setActionErr(err.response?.data?.error || 'Action failed');
    }
  };

  const handleSaveUser = async (formData) => {
    await client.put(`users/${editUser.id}`, formData);
    load();
  };

  const deleteUser = async (id) => {
    setActionErr('');
    try {
      await client.delete(`users/${id}`);
      load();
    } catch (err) {
      setActionErr(err.response?.data?.error || 'Delete failed');
    }
    setConfirm(null);
  };

  const handleExportMembers = () => {
    if (!users.length) return;
    setExportLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const rows = users.map(u => [
      [u.first_name, u.last_name].filter(Boolean).join(' ') || '',
      u.email || '',
      u.role || '',
      u.role_level?.replace(/_/g, ' ') || '',
      u.is_active ? 'Active' : 'Inactive',
    ]);
    downloadCSV(rows, ['Name', 'Email', 'Role', 'Level', 'Status'], `members_${companyId}_${today}.csv`);
    setExportLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{users.length} member{users.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          {users.length > 0 && (
            <button onClick={handleExportMembers} disabled={exportLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
              <Download size={12} />
              {exportLoading ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
          {hasPermission('create_user') && (
          <button onClick={() => setShowBulk(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
            style={{
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
            }}>
            <Upload size={13} /> Bulk Upload
          </button>
          )}
          {hasPermission('create_user') && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} className="flex items-center gap-1.5">
            <PlusCircle size={15} /> Add Member
          </Button>
          )}
        </div>
      </div>

      {actionErr && <p className="text-sm text-error-600">{actionErr}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
      ) : users.length === 0 ? (
        <Card className="p-10 text-center">
          <Users size={40} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm">No members yet. Add the first one.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                  {['Name','Email','Role','Level','Status','Actions'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} onClick={() => setViewUser(u)}
                    className="hover:bg-bg-secondary cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2.5 font-semibold text-text">
                      {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{u.email || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{u.role || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary capitalize">{u.role_level?.replace(/_/g,' ') || '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={u.is_active ? 'success' : 'secondary'} size="sm">
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {hasPermission('edit_user') && (
                        <button
                          onClick={() => setEditUser(u)}
                          title="Edit user"
                          className="p-1 rounded hover:bg-bg-secondary transition-colors"
                        >
                          <Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} />
                        </button>
                        )}
                        {hasPermission('edit_user') && (
                        <button
                          onClick={() => toggleActive(u)}
                          title={u.is_active ? 'Deactivate' : 'Activate'}
                          className="p-1 rounded hover:bg-bg-secondary transition-colors"
                        >
                          {u.is_active
                            ? <XCircle size={15} className="text-warning-500" />
                            : <CheckCircle size={15} className="text-success-500" />}
                        </button>
                        )}
                        {hasPermission('delete_user') && (
                        <button
                          onClick={() => setConfirm({ id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email })}
                          title="Delete"
                          className="p-1 rounded hover:bg-error-50 dark:hover:bg-error-900 transition-colors"
                        >
                          <Trash2 size={15} className="text-error-500" />
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateUserModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        companyId={companyId}
        onCreated={() => load()}
      />

      <BulkUploadModal
        isOpen={showBulk}
        onClose={() => setShowBulk(false)}
        companyId={companyId}
        onDone={() => load()}
      />

      {editUser && (
        <UserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSave={handleSaveUser}
        />
      )}

      {/* Delete confirm modal */}
      {confirm && (
        <Modal isOpen title="Delete Member" onClose={() => setConfirm(null)} size="sm">
          <p className="text-text-secondary text-sm mb-6">
            Permanently delete <strong>{confirm.name}</strong>? This removes them from auth and cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteUser(confirm.id)}>Delete</Button>
          </div>
        </Modal>
      )}

      <UserDetailDrawer user={viewUser} onClose={() => setViewUser(null)} />
    </div>
  );
};

// ── RolesPanel ─────────────────────────────────────────────────────────────────
const RolesPanel = ({ companyId }) => {
  const { hasPermission } = useAuth();
  const [roles, setRoles]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole]     = useState(null);
  const [seeding, setSeeding]       = useState(false);
  const [actionErr, setActionErr]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    client.get('roles', { params: { company_id: companyId } })
      .then(r => setRoles(r.data.roles || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [companyId]);

  const seedDefaults = async () => {
    setSeeding(true);
    setActionErr('');
    try {
      await client.post('roles/seed-defaults', { company_id: companyId });
      load();
    } catch (err) {
      setActionErr(err.response?.data?.error || 'Seeding failed');
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateRole = async (formData) => {
    await client.post('roles', { ...formData, company_id: companyId });
    load();
    setShowCreate(false);
  };

  const handleEditRole = async (formData) => {
    await client.put(`roles/${editRole.id}`, { description: formData.description, permissions: formData.permissions });
    load();
    setEditRole(null);
  };

  const deleteRole = async (id) => {
    setActionErr('');
    try {
      await client.delete(`roles/${id}`);
      load();
    } catch (err) {
      setActionErr(err.response?.data?.error || 'Delete failed');
    }
  };

  const LEVEL_COLORS = {
    fronter: 'success', closer: 'info', manager: 'warning',
    closer_manager: 'primary', operations_manager: 'info', company_admin: 'error',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 justify-between flex-wrap">
        <p className="text-sm text-text-secondary">{roles.length} role{roles.length !== 1 ? 's' : ''}</p>
        {hasPermission('manage_roles') && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={seedDefaults} loading={seeding} disabled={seeding}>
            Seed Defaults
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} className="flex items-center gap-1.5">
            <PlusCircle size={15} /> Add Role
          </Button>
        </div>
        )}
      </div>

      {actionErr && <p className="text-sm text-error-600">{actionErr}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
      ) : roles.length === 0 ? (
        <Card className="p-10 text-center">
          <Shield size={40} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm mb-4">No roles. Seed defaults or add one manually.</p>
          <Button variant="primary" size="sm" onClick={seedDefaults} loading={seeding}>Seed Defaults</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map(r => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text truncate">{r.name}</p>
                  <div className="mt-1">
                    <Badge variant={LEVEL_COLORS[r.level] || 'secondary'} size="sm">
                      {r.level?.replace(/_/g,' ')}
                    </Badge>
                  </div>
                </div>
                {hasPermission('manage_roles') && (
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <button onClick={() => setEditRole(r)} className="p-1 rounded hover:bg-bg-secondary transition-colors" title="Edit role">
                    <Edit2 size={14} style={{ color: 'var(--color-primary-500)' }} />
                  </button>
                  <button onClick={() => deleteRole(r.id)} className="p-1 rounded hover:bg-error-50 dark:hover:bg-error-900 transition-colors" title="Delete role">
                    <Trash2 size={14} className="text-error-500" />
                  </button>
                </div>
                )}
              </div>
              {r.description && <p className="text-xs text-text-secondary mb-2">{r.description}</p>}
              <p className="text-xs text-text-tertiary">{(r.permissions||[]).length} permissions</p>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <RoleModal
          role={null}
          onClose={() => setShowCreate(false)}
          onSave={handleCreateRole}
        />
      )}

      {editRole && (
        <RoleModal
          role={editRole}
          onClose={() => setEditRole(null)}
          onSave={handleEditRole}
        />
      )}
    </div>
  );
};

// ── SettingsPanel ─────────────────────────────────────────────────────────────
const SettingsPanel = ({ company, onCompanyUpdated }) => {
  const { hasPermission } = useAuth();
  const [name, setName]               = useState(company.name || '');
  const [companyType, setCompanyType] = useState(company.company_type || 'fronter');
  const [saving, setSaving]           = useState(false);
  const [saveErr, setSaveErr]         = useState('');
  const [saveOk, setSaveOk]           = useState(false);

  // Links (fronter only)
  const [links, setLinks]               = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [allClosers, setAllClosers]     = useState([]);
  const [selectedCloser, setSelectedCloser] = useState('');
  const [linking, setLinking]           = useState(false);
  const [linkErr, setLinkErr]           = useState('');

  const loadLinks = useCallback(() => {
    if (companyType !== 'fronter') return;
    setLinksLoading(true);
    client.get(`companies/${company.id}/links`)
      .then(r => setLinks(r.data.links || []))
      .catch(() => {})
      .finally(() => setLinksLoading(false));
  }, [company.id, companyType]);

  const loadAllCloserCompanies = useCallback(() => {
    if (companyType !== 'fronter') return;
    client.get('companies')
      .then(r => setAllClosers((r.data.companies || []).filter(c => c.company_type === 'closer')))
      .catch(() => {});
  }, [companyType]);

  useEffect(() => { loadLinks(); loadAllCloserCompanies(); }, [company.id, companyType]);

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true); setSaveErr(''); setSaveOk(false);
    try {
      await client.put(`companies/${company.id}`, { name, company_type: companyType });
      setSaveOk(true);
      onCompanyUpdated?.({ ...company, name, company_type: companyType });
      setTimeout(() => setSaveOk(false), 3000);
    } catch (err) {
      setSaveErr(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const linkCloser = async () => {
    if (!selectedCloser) return;
    setLinking(true); setLinkErr('');
    try {
      await client.post(`companies/${company.id}/links`, { closer_company_id: selectedCloser });
      setSelectedCloser('');
      loadLinks();
    } catch (err) {
      setLinkErr(err.response?.data?.error || 'Link failed');
    } finally {
      setLinking(false);
    }
  };

  const removeLink = async (linkId) => {
    try {
      await client.delete(`companies/${company.id}/links/${linkId}`);
      loadLinks();
    } catch (err) {
      setLinkErr(err.response?.data?.error || 'Remove failed');
    }
  };

  const linkedIds = new Set(links.map(l => l.id));
  const availableClosers = allClosers.filter(c => !linkedIds.has(c.id));

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Basic info */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><Settings size={18} /> Company Settings</h3>
        <form onSubmit={saveSettings} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Company Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Company Type</label>
            <div className="flex gap-3">
              {[{ value: 'fronter', label: 'Fronter Company', desc: 'Has fronters who create leads and transfer calls', color: 'success' },
                { value: 'closer', label: 'Closer Company', desc: 'Has closers who receive transfers and close deals', color: 'primary' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCompanyType(opt.value)}
                  className="flex-1 p-4 rounded-xl border-2 text-left transition-all"
                  style={{
                    borderColor: companyType === opt.value ? `var(--color-${opt.color}-500)` : 'var(--color-border)',
                    background:  companyType === opt.value ? `var(--color-${opt.color}-50)`  : 'transparent',
                  }}
                >
                  <p className={`font-semibold text-sm text-${opt.color}-700 mb-1`}>{opt.label}</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {saveErr && <p className="text-sm text-error-600">{saveErr}</p>}
          {saveOk  && <p className="text-sm text-success-600">Settings saved.</p>}

          {hasPermission('edit_company') && (
          <div className="pt-2">
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>Save Settings</Button>
          </div>
          )}
        </form>
      </Card>

      {/* Linked closer companies (fronter only) */}
      {companyType === 'fronter' && (
        <Card className="p-6">
          <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2"><LinkIcon size={18} /> Linked Closer Companies</h3>
          <p className="text-sm text-text-secondary mb-4">Fronters in this company will see closers from all linked closer companies.</p>

          {linkErr && <p className="text-sm text-error-600 mb-3">{linkErr}</p>}

          {/* Link new company */}
          <div className="flex gap-2 mb-4">
            <select
              className="input flex-1"
              value={selectedCloser}
              onChange={e => setSelectedCloser(e.target.value)}
            >
              <option value="">— Select a closer company to link —</option>
              {availableClosers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={linkCloser}
              loading={linking}
              disabled={!selectedCloser || linking}
              className="flex items-center gap-1.5 whitespace-nowrap"
            >
              <Link size={14} /> Link
            </Button>
          </div>

          {availableClosers.length === 0 && allClosers.length === 0 && (
            <p className="text-xs text-warning-600 mb-3">No closer companies exist yet. Create a company with type "Closer" first.</p>
          )}

          {/* Current links */}
          {linksLoading ? (
            <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" /></div>
          ) : links.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-4">No closer companies linked yet.</p>
          ) : (
            <div className="space-y-2">
              {links.map(l => (
                <div key={l.link_id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary-500" />
                    <span className="font-semibold text-sm text-text">{l.name}</span>
                    <Badge variant="primary" size="sm">Closer</Badge>
                  </div>
                  <button
                    onClick={() => removeLink(l.link_id)}
                    className="p-1.5 rounded-lg hover:bg-error-50 dark:hover:bg-error-900 transition-colors"
                    title="Remove link"
                  >
                    <Unlink size={14} className="text-error-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ── NumbersPanel ──────────────────────────────────────────────────────────────
const NUM_STATUS_BADGE = { active: 'success', claimable: 'warning', released: 'secondary' };

const NumbersPanel = ({ companyId }) => {
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('');
  const [page, setPage]         = useState(1);
  const [selected, setSelected] = useState(null);
  const LIMIT = 50;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callback-numbers', {
        params: { company_id: companyId, search: search || undefined, status: status || undefined, page: p, limit: LIMIT },
      });
      setRows(res.data.numbers || []);
      setTotal(res.data.total || 0);
      setPage(p);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [companyId, search, status]);

  useEffect(() => { load(1); }, [companyId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(1)}
            placeholder="Search phone…" className="input pl-9 text-sm" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="input text-sm w-40">
          <option value="">All statuses</option>
          {['active','claimable','released'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>
        <button onClick={() => load(1)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--gradient-sidebar)' }}>
          Search · {total}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-text-secondary py-8 text-sm">No callback numbers.</p>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                  {['Phone Number','Owner','Status','Attempts','Last Outcome'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} onClick={() => setSelected(r)}
                    className="hover:bg-bg-secondary cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Hash size={11} style={{ color: 'var(--color-primary-500)', flexShrink: 0 }} />
                        <span className="font-mono font-semibold text-text">{r.phone_number}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{r.owner_name || <span className="italic opacity-60">Unowned</span>}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={NUM_STATUS_BADGE[r.status] || 'secondary'} size="sm">
                        {r.status?.charAt(0).toUpperCase()+r.status?.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-center text-text-secondary">{r.attempt_count ?? 0}</td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary capitalize">{r.last_outcome?.replace(/_/g,' ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs text-text-secondary">{(page-1)*LIMIT+1}–{Math.min(page*LIMIT,total)} of {total}</span>
              <div className="flex gap-2">
                <button disabled={page===1} onClick={() => load(page-1)} className="px-3 py-1 rounded text-xs font-semibold disabled:opacity-40" style={{color:'var(--color-text-secondary)'}}>Prev</button>
                <button disabled={page*LIMIT>=total} onClick={() => load(page+1)} className="px-3 py-1 rounded text-xs font-semibold disabled:opacity-40" style={{color:'var(--color-text-secondary)'}}>Next</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {selected && (
        <CallbackNumberDetailDrawer
          numberId={selected.id}
          numberRow={selected}
          onClose={() => setSelected(null)}
          apiBase="compliance/callback-numbers"
        />
      )}
    </div>
  );
};

// ── main CompanyDetail ────────────────────────────────────────────────────────
const CompanyDetail = ({ company: initialCompany, onBack, onUpdate }) => {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [refresh, setRefresh]     = useState(0);
  const [company, setCompany]     = useState(initialCompany);
  const prevId = useRef(initialCompany.id);

  // Reset panel when a different company is selected (guards against missing key prop)
  useEffect(() => {
    if (initialCompany.id !== prevId.current) {
      prevId.current = initialCompany.id;
      setActiveTab('overview');
      setRefresh(0);
    }
    setCompany(initialCompany);
  }, [initialCompany]);

  const TABS = [
    { key: 'overview',   label: 'Overview',  icon: BarChart3  },
    ...(hasPermission('view_company_members') ? [{ key: 'members',   label: 'Members',   icon: Users      }] : []),
    ...(hasPermission('manage_roles')         ? [{ key: 'roles',     label: 'Roles',     icon: Shield     }] : []),
    ...(hasPermission('edit_company')         ? [{ key: 'settings',  label: 'Settings',  icon: Settings   }] : []),
    { key: 'transfers',  label: 'Transfers',    icon: Send       },
    { key: 'sales',      label: 'Sales',        icon: DollarSign },
    { key: 'callbacks',  label: 'Callbacks',    icon: Calendar   },
    { key: 'numbers',    label: 'Call Numbers', icon: Hash       },
  ];

  const handleCompanyUpdated = (updated) => {
    setCompany(updated);
    onUpdate?.(updated);
  };

  return (
    <div>
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 pb-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}>

        {/* logo or icon */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
          style={{
            background: company.logo_url ? 'transparent' : 'var(--gradient-sidebar)',
            border: `1px solid var(--color-border)`,
          }}>
          {company.logo_url
            ? <img src={company.logo_url} alt="" className="w-full h-full object-cover"
                onError={e => { e.target.style.display = 'none'; }} />
            : <Building2 size={16} className="text-white" />
          }
        </div>

        {/* name + meta */}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-text leading-tight truncate">{company.name}</h2>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {company.slug && (
              <span className="text-[11px] font-mono text-text-secondary">{company.slug}</span>
            )}
            <Badge variant={company.is_active ? 'success' : 'secondary'} size="sm">
              {company.is_active ? 'Active' : 'Inactive'}
            </Badge>
            {company.company_type && (
              <Badge variant={company.company_type === 'fronter' ? 'success' : 'primary'} size="sm">
                {company.company_type === 'fronter' ? 'Fronter' : 'Closer'}
              </Badge>
            )}
            {company.created_at && (
              <span className="text-[11px] text-text-secondary hidden sm:inline">
                Since {new Date(company.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setRefresh(r => r + 1)}
            className="p-2 rounded-lg hover:bg-bg-secondary transition-colors" title="Refresh data">
            <RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
          {onBack && (
            <button onClick={onBack}
              className="p-2 rounded-lg hover:bg-bg-secondary transition-colors" title="Deselect company">
              <ArrowLeft size={14} style={{ color: 'var(--color-text-secondary)' }} />
            </button>
          )}
        </div>
      </div>

      {/* ── tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-0.5 mb-5 p-1 rounded-xl overflow-x-auto"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0"
            style={{
              backgroundColor: activeTab === t.key ? 'var(--color-surface)' : 'transparent',
              color:            activeTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
              boxShadow:        activeTab === t.key ? 'var(--shadow-sm)' : 'none',
            }}>
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* panels */}
      {activeTab === 'overview'   && <OverviewPanel  key={`ov-${refresh}`} companyId={company.id} />}
      {activeTab === 'members'    && <MembersPanel   key={`mb-${refresh}`} companyId={company.id} />}
      {activeTab === 'roles'      && <RolesPanel     key={`ro-${refresh}`} companyId={company.id} />}
      {activeTab === 'settings'   && <SettingsPanel  key={`st-${refresh}`} company={company} onCompanyUpdated={handleCompanyUpdated} />}
      {activeTab === 'transfers'  && <RecordsPanel   key={`tr-${refresh}`} companyId={company.id} type="transfers" />}
      {activeTab === 'sales'      && <RecordsPanel   key={`sa-${refresh}`} companyId={company.id} type="sales" />}
      {activeTab === 'callbacks'  && <RecordsPanel   key={`cb-${refresh}`} companyId={company.id} type="callbacks" />}
      {activeTab === 'numbers'    && <NumbersPanel   key={`nb-${refresh}`} companyId={company.id} />}
    </div>
  );
};

export default CompanyDetail;
