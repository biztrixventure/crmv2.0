import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Phone, Mail, Building2, X, Clock, CheckCircle,
  AlertTriangle, Info, Activity, FileText, Calendar, User,
  ChevronRight, ArrowRight,
} from 'lucide-react';
import client from '../../api/client';
import LeadGraph from './LeadGraph';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtKey = (k) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};
const fmtDateShort = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ── Status configs ────────────────────────────────────────────────────────────
const SALE_STATUS = {
  open:           { label: 'Pending',   bg: '#dbeafe', color: '#2563eb' },
  pending_review: { label: 'In Review', bg: '#fef3c7', color: '#d97706' },
  needs_revision: { label: 'Revision',  bg: '#fee2e2', color: '#dc2626' },
  closed_won:     { label: 'Won',       bg: '#dcfce7', color: '#16a34a' },
  closed_lost:    { label: 'Lost',      bg: '#fee2e2', color: '#dc2626' },
  sold:           { label: 'Sold',      bg: '#dcfce7', color: '#16a34a' },
  cancelled:      { label: 'Cancelled', bg: '#fee2e2', color: '#dc2626' },
};
const TRANSFER_STATUS = {
  pending:   { label: 'Pending',  bg: '#fef3c7', color: '#d97706' },
  accepted:  { label: 'Accepted', bg: '#dcfce7', color: '#16a34a' },
  rejected:  { label: 'Rejected', bg: '#fee2e2', color: '#dc2626' },
  completed: { label: 'Done',     bg: '#dcfce7', color: '#16a34a' },
};
const CB_STATUS = {
  pending:           { label: 'Pending',   bg: '#fef3c7', color: '#d97706' },
  completed:         { label: 'Done',      bg: '#dcfce7', color: '#16a34a' },
  no_answer:         { label: 'No Answer', bg: '#f3f4f6', color: '#6b7280' },
  answering_machine: { label: 'Voicemail', bg: '#ede9fe', color: '#7c3aed' },
  cancelled:         { label: 'Cancelled', bg: '#fee2e2', color: '#dc2626' },
};

const StatusBadge = ({ status, map }) => {
  const cfg = map?.[status] || { label: status || '–', bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
};

// ── Timeline event config ─────────────────────────────────────────────────────
const EV = {
  created:      { color: '#2563eb', bg: '#dbeafe', Icon: FileText      },
  assigned:     { color: '#7c3aed', bg: '#ede9fe', Icon: ArrowRight    },
  updated:      { color: '#6b7280', bg: '#f3f4f6', Icon: Activity      },
  approved:     { color: '#16a34a', bg: '#dcfce7', Icon: CheckCircle   },
  returned:     { color: '#dc2626', bg: '#fee2e2', Icon: AlertTriangle },
  submitted:    { color: '#7c3aed', bg: '#ede9fe', Icon: ArrowRight    },
  scheduled:    { color: '#0891b2', bg: '#cffafe', Icon: Calendar      },
  status_change:{ color: '#7c3aed', bg: '#ede9fe', Icon: Activity      },
  rescheduled:  { color: '#d97706', bg: '#fef3c7', Icon: Clock         },
};
const TYPE_COLOR  = { transfer: '#2563eb', sale: '#16a34a', callback: '#d97706' };
const ROLE_CONFIG = {
  Fronter:    { bg: '#dbeafe', color: '#1d4ed8' },
  Closer:     { bg: '#dcfce7', color: '#15803d' },
  Compliance: { bg: '#fee2e2', color: '#dc2626' },
  Agent:      { bg: '#fef3c7', color: '#b45309' },
  Manager:    { bg: '#f3f4f6', color: '#374151' },
};

// ── Result group card ─────────────────────────────────────────────────────────
const ResultCard = ({ group, onClick }) => {
  const converted = group.sales?.some(s => ['closed_won', 'sold'].includes(s.status));
  return (
    <button onClick={() => onClick(group)}
      className="w-full text-left p-4 rounded-xl border transition-all duration-150 hover:shadow-md hover:border-primary-300 group"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
              {group.name || 'Unknown Lead'}
            </p>
            {converted && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold text-green-700 bg-green-100">✓ Converted</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {group.phone && <span className="flex items-center gap-1"><Phone size={10} />{group.phone}</span>}
            {group.email && <span className="flex items-center gap-1"><Mail  size={10} />{group.email}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.transfers?.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#dbeafe', color: '#2563eb' }}>
                {group.transfers.length} transfer{group.transfers.length !== 1 ? 's' : ''}
              </span>
            )}
            {group.sales?.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}>
                {group.sales.length} sale{group.sales.length !== 1 ? 's' : ''}
              </span>
            )}
            {group.callbacks?.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
                {group.callbacks.length} callback{group.callbacks.length !== 1 ? 's' : ''}
              </span>
            )}
            {group.companies?.length > 1 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#cffafe', color: '#0891b2' }}>
                {group.companies.length} companies
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1 pt-0.5">
          <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }}
            className="group-hover:text-primary-600 transition-colors" />
          {group.last_activity && (
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {fmtDateShort(group.last_activity)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

// ── Profile Drawer ────────────────────────────────────────────────────────────
const ProfileDrawer = ({ group, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [tab,     setTab]     = useState('overview');
  const [recTab,  setRecTab]  = useState('transfers');

  const loadProfile = useCallback(async () => {
    if (!group) return;
    setLoading(true);
    setProfile(null);
    try {
      const params = {};
      if (group.phone) params.phone = group.phone;
      else if (group.email) params.email = group.email;
      else if (group.name)  params.name  = group.name;
      const res = await client.get('lead-intelligence/profile', { params });
      setProfile(res.data);
    } catch { /* profile remains null */ }
    finally { setLoading(false); }
  }, [group?.phone, group?.email, group?.name]);

  useEffect(() => { loadProfile(); setTab('overview'); setRecTab('transfers'); }, [loadProfile]);

  const ins = profile?.insights;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onClick={onClose} />

      <div className="fixed right-0 top-0 h-full z-50 flex flex-col shadow-2xl animate-slide-in-right"
        style={{ width: 'min(660px, 100vw)', backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-white/20 flex-shrink-0">
              <Search size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">
                {group?.name || 'Lead Intelligence'}
              </h2>
              <p className="text-xs text-white/70">{group?.phone || group?.email || 'Unknown'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors flex-shrink-0">
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Alert flags */}
        {profile?.flags?.length > 0 && (
          <div className="px-4 pt-3 pb-1 flex-shrink-0 space-y-1.5">
            {profile.flags.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                style={{
                  backgroundColor: f.type === 'warning' ? '#fef3c7' : '#cffafe',
                  color:           f.type === 'warning' ? '#b45309' : '#0e7490',
                  border:          `1px solid ${f.type === 'warning' ? '#fde68a' : '#a5f3fc'}`,
                }}>
                {f.type === 'warning' ? <AlertTriangle size={12} /> : <Info size={12} />}
                {f.msg}
              </div>
            ))}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 px-4 pt-3 pb-0 flex-shrink-0 overflow-x-auto"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'graph',    label: 'Graph'    },
            { id: 'timeline', label: 'Timeline' },
            { id: 'records',  label: 'Records'  },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-4 py-2 rounded-t-lg text-xs font-semibold whitespace-nowrap transition-all"
              style={{
                backgroundColor: tab === t.id ? 'var(--color-surface)' : 'transparent',
                color:           tab === t.id ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                borderBottom:    tab === t.id ? '2px solid var(--color-primary-600)' : '2px solid transparent',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex justify-center items-center py-24">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : !profile ? (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Failed to load profile.</p>
            </div>
          ) : (
            <>
              {/* ── OVERVIEW ───────────────────────────────────────────────── */}
              {tab === 'overview' && (
                <div className="space-y-4">
                  {/* Stat grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Transfers',  value: ins.total_transfers, color: '#2563eb', bg: '#dbeafe' },
                      { label: 'Sales',      value: ins.total_sales,     color: '#16a34a', bg: '#dcfce7' },
                      { label: 'Callbacks',  value: ins.total_callbacks, color: '#d97706', bg: '#fef3c7' },
                      { label: 'Converted',  value: ins.converted,       color: '#16a34a', bg: '#dcfce7' },
                      { label: 'Companies',  value: ins.companies_count, color: '#0891b2', bg: '#cffafe' },
                      { label: 'Agents',     value: ins.agents_count,    color: '#7c3aed', bg: '#ede9fe' },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl p-3 text-center"
                        style={{ backgroundColor: s.bg, border: `1px solid ${s.color}30` }}>
                        <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-xs font-semibold mt-0.5" style={{ color: s.color }}>{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Conversion bar */}
                  {ins.total_sales > 0 && (
                    <div className="rounded-xl p-4"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                          Conversion Rate
                        </span>
                        <span className="text-sm font-bold" style={{ color: '#16a34a' }}>{ins.conv_rate}%</span>
                      </div>
                      <div className="h-2 rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${Math.min(ins.conv_rate, 100)}%`, backgroundColor: '#16a34a' }} />
                      </div>
                    </div>
                  )}

                  {/* Last activity */}
                  {ins.last_activity && (
                    <div className="rounded-xl p-3 flex items-center gap-3"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      <Clock size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                      <div>
                        <p className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Last Activity</p>
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                          {fmtDate(ins.last_activity)}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Companies */}
                  {Object.values(profile.companies).length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide mb-2"
                        style={{ color: 'var(--color-text-secondary)' }}>Companies Involved</p>
                      <div className="space-y-1.5">
                        {Object.values(profile.companies).map(co => (
                          <div key={co.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                            <Building2 size={13} style={{ color: '#0891b2' }} />
                            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                              {co.name || co.slug}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Agents */}
                  {Object.keys(profile.profiles).length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide mb-2"
                        style={{ color: 'var(--color-text-secondary)' }}>Agents Involved</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(profile.profiles).map(([id, p]) => (
                          <div key={id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              {(p.name || '?')[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.name}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── GRAPH ──────────────────────────────────────────────────── */}
              {tab === 'graph' && (
                <div>
                  {profile.graph?.nodes?.length > 0 ? (
                    <>
                      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                        {profile.graph.nodes.length} nodes · {profile.graph.edges.length} connections
                        &nbsp;·&nbsp;Scroll to zoom · drag to pan
                      </p>
                      <LeadGraph nodes={profile.graph.nodes} edges={profile.graph.edges} />
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No graph data.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── TIMELINE ───────────────────────────────────────────────── */}
              {tab === 'timeline' && (
                profile.timeline.length === 0 ? (
                  <p className="text-sm text-center py-12" style={{ color: 'var(--color-text-secondary)' }}>
                    No timeline events.
                  </p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-4 top-2 bottom-2 w-0.5"
                      style={{ backgroundColor: 'var(--color-border)' }} />
                    <div className="space-y-3 pl-10">
                      {profile.timeline.map((item) => {
                        const cfg  = EV[item.action] || EV.updated;
                        const { Icon } = cfg;
                        const tc      = TYPE_COLOR[item.type] || '#6b7280';
                        const roleCfg = ROLE_CONFIG[item.actor_role] || ROLE_CONFIG.Agent;
                        // Highlight compliance events
                        const isCompliance = item.actor_role === 'Compliance';
                        const borderStyle  = isCompliance
                          ? '1px solid #fca5a5'
                          : '1px solid var(--color-border)';
                        const bgStyle = isCompliance ? '#fff5f5' : 'var(--color-bg-secondary)';
                        return (
                          <div key={item.id} className="relative">
                            {/* Dot */}
                            <div className="absolute -left-10 top-2.5 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center"
                              style={{ backgroundColor: cfg.color }}>
                              <Icon size={8} className="text-white" />
                            </div>

                            <div className="rounded-xl p-3"
                              style={{ backgroundColor: bgStyle, border: borderStyle }}>
                              {/* Top row: label + type badge + timestamp */}
                              <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs px-1.5 py-0.5 rounded font-bold"
                                    style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                                    {item.label}
                                  </span>
                                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
                                    style={{ backgroundColor: `${tc}18`, color: tc }}>
                                    {item.type}
                                  </span>
                                </div>
                                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                                  {fmtDate(item.occurred_at)}
                                </span>
                              </div>

                              {/* Actor row: name + role badge + company */}
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <User size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                                <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>
                                  {item.actor}
                                </span>
                                {item.actor_role && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                                    style={{ backgroundColor: roleCfg.bg, color: roleCfg.color }}>
                                    {item.actor_role}
                                  </span>
                                )}
                                {item.company && (
                                  <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                    <Building2 size={10} />
                                    {item.company}
                                  </span>
                                )}
                              </div>

                              {/* Detail */}
                              {item.detail && (
                                <p className="text-xs mt-0.5 pl-3.5" style={{ color: 'var(--color-text-secondary)' }}>
                                  {item.detail}
                                </p>
                              )}

                              {item.status && (
                                <div className="mt-1.5 pl-3.5">
                                  <StatusBadge status={item.status}
                                    map={{ ...SALE_STATUS, pending: { label: 'Pending', bg: '#fef3c7', color: '#d97706' }, completed: { label: 'Completed', bg: '#dcfce7', color: '#16a34a' }, pending_review: { label: 'In Review', bg: '#fef3c7', color: '#d97706' } }} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* ── RECORDS ────────────────────────────────────────────────── */}
              {tab === 'records' && (
                <div>
                  <div className="flex gap-1 p-1 mb-3 rounded-xl"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    {[
                      { id: 'transfers', label: `Transfers (${profile.transfers.length})` },
                      { id: 'sales',     label: `Sales (${profile.sales.length})`         },
                      { id: 'callbacks', label: `Callbacks (${profile.callbacks.length})` },
                    ].map(t => (
                      <button key={t.id} onClick={() => setRecTab(t.id)}
                        className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{
                          backgroundColor: recTab === t.id ? 'var(--color-surface)' : 'transparent',
                          color:           recTab === t.id ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                          boxShadow:       recTab === t.id ? 'var(--shadow-sm)' : 'none',
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Transfers list */}
                  {recTab === 'transfers' && (
                    <div className="space-y-3">
                      {profile.transfers.length === 0 ? (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>No transfers.</p>
                      ) : profile.transfers.map(t => {
                        const fd      = t.form_data || {};
                        const tName   = fd.customer_name || [fd.FirstName, fd.LastName].filter(Boolean).join(' ') || 'Unknown';
                        const agent   = profile.profiles?.[t.created_by];
                        const company = profile.companies?.[t.company_id];
                        // All form_data entries except internal/empty
                        const fdEntries = Object.entries(fd).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
                        return (
                          <div key={t.id} className="rounded-xl overflow-hidden"
                            style={{ border: '1px solid var(--color-border)' }}>
                            {/* Header row */}
                            <div className="flex items-center justify-between gap-2 px-3 py-2"
                              style={{ backgroundColor: '#dbeafe', borderBottom: '1px solid #bfdbfe' }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-sm truncate" style={{ color: '#1e40af' }}>{tName}</span>
                                {company && (
                                  <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: '#2563eb' }}>
                                    <Building2 size={10} />{company.name || company.slug}
                                  </span>
                                )}
                              </div>
                              <StatusBadge status={t.status} map={TRANSFER_STATUS} />
                            </div>

                            {/* Meta row */}
                            <div className="px-3 py-2 flex flex-wrap gap-x-4 gap-y-1"
                              style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                              {agent && (
                                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                  <User size={10} />{agent.name}
                                </span>
                              )}
                              <span className="text-xs font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                                ID: {t.id.slice(0, 8).toUpperCase()}
                              </span>
                              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                {fmtDate(t.created_at)}
                              </span>
                            </div>

                            {/* All form_data fields */}
                            {fdEntries.length > 0 && (
                              <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--color-surface)' }}>
                                <p className="text-xs font-bold uppercase tracking-wide mb-2"
                                  style={{ color: 'var(--color-text-tertiary)' }}>Form Data</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                  {fdEntries.map(([k, v]) => (
                                    <div key={k} className="min-w-0">
                                      <p className="text-xs font-semibold truncate"
                                        style={{ color: 'var(--color-text-tertiary)' }}>{fmtKey(k)}</p>
                                      <p className="text-xs truncate font-medium"
                                        style={{ color: 'var(--color-text)' }}>{String(v)}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Sales list */}
                  {recTab === 'sales' && (
                    <div className="space-y-3">
                      {profile.sales.length === 0 ? (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>No sales.</p>
                      ) : profile.sales.map(s => {
                        const agent   = profile.profiles?.[s.created_by];
                        const company = profile.companies?.[s.company_id];
                        return (
                          <div key={s.id} className="rounded-xl overflow-hidden"
                            style={{ border: '1px solid var(--color-border)' }}>
                            {/* Header */}
                            <div className="flex items-center justify-between gap-2 px-3 py-2"
                              style={{ backgroundColor: '#dcfce7', borderBottom: '1px solid #bbf7d0' }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-sm truncate" style={{ color: '#15803d' }}>{s.customer_name || 'Unknown'}</span>
                                {company && (
                                  <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: '#16a34a' }}>
                                    <Building2 size={10} />{company.name || company.slug}
                                  </span>
                                )}
                              </div>
                              <StatusBadge status={s.status} map={SALE_STATUS} />
                            </div>

                            {/* Body */}
                            <div className="px-3 py-2.5 space-y-1.5" style={{ backgroundColor: 'var(--color-surface)' }}>
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {agent && (
                                  <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                    <User size={10} />{agent.name}
                                  </span>
                                )}
                                {s.reference_no && (
                                  <span className="text-xs font-mono" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</span>
                                )}
                                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(s.created_at)}</span>
                              </div>
                              {s.plan && (
                                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  <span className="font-semibold">Plan:</span> {s.plan}
                                </p>
                              )}
                              {s.closer_disposition && (
                                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  <span className="font-semibold">Disposition:</span> {s.closer_disposition}
                                </p>
                              )}
                              {s.customer_phone && (
                                <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                  <Phone size={10} />{s.customer_phone}
                                </p>
                              )}
                              {s.down_payment && (
                                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  <span className="font-semibold">Down:</span> {s.down_payment}
                                  {s.monthly_payment && <span className="ml-2"><span className="font-semibold">Monthly:</span> {s.monthly_payment}</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Callbacks list */}
                  {recTab === 'callbacks' && (
                    <div className="space-y-3">
                      {profile.callbacks.length === 0 ? (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>No callbacks.</p>
                      ) : profile.callbacks.map(c => {
                        const agent   = profile.profiles?.[c.user_id];
                        const company = profile.companies?.[c.company_id];
                        return (
                          <div key={c.id} className="rounded-xl overflow-hidden"
                            style={{ border: '1px solid var(--color-border)' }}>
                            {/* Header */}
                            <div className="flex items-center justify-between gap-2 px-3 py-2"
                              style={{ backgroundColor: '#fef3c7', borderBottom: '1px solid #fde68a' }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-sm truncate" style={{ color: '#b45309' }}>{c.customer_name || 'Unknown'}</span>
                                {company && (
                                  <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: '#d97706' }}>
                                    <Building2 size={10} />{company.name || company.slug}
                                  </span>
                                )}
                              </div>
                              <StatusBadge status={c.status} map={CB_STATUS} />
                            </div>

                            {/* Body */}
                            <div className="px-3 py-2.5 space-y-1.5" style={{ backgroundColor: 'var(--color-surface)' }}>
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {agent && (
                                  <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                    <User size={10} />{agent.name}
                                  </span>
                                )}
                                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                  <Calendar size={10} />{fmtDate(c.callback_at)}
                                </span>
                              </div>
                              {c.customer_phone && (
                                <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                                  <Phone size={10} />{c.customer_phone}
                                </p>
                              )}
                              {c.notes && (
                                <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>"{c.notes}"</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const LeadIntelligence = () => {
  const [query,         setQuery]         = useState('');
  const [debounced,     setDebounced]     = useState('');
  const [results,       setResults]       = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const inputRef = useRef(null);

  // 300ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Fire search
  useEffect(() => {
    if (!debounced || debounced.length < 2) { setResults(null); return; }
    setLoading(true);
    client.get('lead-intelligence/search', { params: { q: debounced } })
      .then(r => setResults(r.data.groups || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debounced]);

  const clearSearch = () => { setQuery(''); setResults(null); inputRef.current?.focus(); };

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Search size={15} style={{ color: 'var(--color-primary-600)' }} />
          Lead Intelligence Search
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Search any phone, email, or name — see the full relationship graph, activity timeline, and history across all companies.
        </p>
      </div>

      {/* Search input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          {loading
            ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
            : <Search size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          }
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search phone number, email, name, reference no…"
          className="input pl-10 pr-10 py-3 w-full"
          style={{ fontSize: '15px' }}
          autoFocus
        />
        {query && (
          <button onClick={clearSearch}
            className="absolute inset-y-0 right-0 pr-4 flex items-center transition-opacity hover:opacity-70">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        )}
      </div>

      {/* Tips — shown when idle */}
      {!query && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          {[
            {
              Icon: Phone,
              title: 'Phone Search',
              desc:  'Enter any phone number to trace all activity: transfers, sales, and callbacks across every company and agent.',
            },
            {
              Icon: Activity,
              title: 'Relationship Graph',
              desc:  'See who created a lead, who worked it, which companies touched it — rendered as an interactive relationship graph.',
            },
            {
              Icon: Clock,
              title: 'Full Timeline',
              desc:  'Every action ever taken on a lead — creation, edits, callbacks, reschedules, sales, approvals — in chronological order.',
            },
          ].map(tip => (
            <div key={tip.title} className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <tip.Icon size={18} className="mb-2" style={{ color: 'var(--color-primary-600)' }} />
              <p className="font-bold text-sm mb-1" style={{ color: 'var(--color-text)' }}>{tip.title}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{tip.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {results !== null && (
        <div>
          <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {results.length === 0
              ? 'No leads found for this search.'
              : `${results.length} lead${results.length !== 1 ? 's' : ''} found — click to view full profile`}
          </p>
          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((g, i) => (
                <ResultCard key={g.key || i} group={g} onClick={setSelectedGroup} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Profile drawer */}
      {selectedGroup && (
        <ProfileDrawer group={selectedGroup} onClose={() => setSelectedGroup(null)} />
      )}
    </div>
  );
};

export default LeadIntelligence;
