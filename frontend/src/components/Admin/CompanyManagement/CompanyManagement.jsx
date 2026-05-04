import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Building2, ChevronRight,
  Edit2, XCircle, CheckCircle, Trash2,
  ArrowUpDown, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Alert } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';
import CompanyModal from './CompanyModal';
import CompanyDetail from './CompanyDetail';

// ── type style map ─────────────────────────────────────────────────────────────
const TYPE = {
  fronter: { bg: 'var(--color-success-50)',  color: 'var(--color-success-700)',  border: 'var(--color-success-200)',  label: 'Fronter' },
  closer:  { bg: 'var(--color-primary-50)', color: 'var(--color-primary-700)', border: 'var(--color-primary-200)', label: 'Closer'  },
};

// ── CompanyCard ────────────────────────────────────────────────────────────────
const CompanyCard = ({ company, isSelected, onSelect, onEdit, onDeactivate, onActivate, onDelete }) => {
  const ts = TYPE[company.company_type] || {};

  return (
    <div
      onClick={() => onSelect(company)}
      className="rounded-xl border cursor-pointer transition-all group"
      style={{
        borderColor: isSelected ? 'var(--color-primary-500)' : 'var(--color-border)',
        backgroundColor: isSelected ? 'var(--color-primary-50)' : 'var(--color-surface)',
        boxShadow: isSelected ? '0 0 0 1px var(--color-primary-500)' : 'none',
      }}
    >
      {/* top row */}
      <div className="flex items-start gap-2.5 p-2.5">
        {/* logo / icon */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
          style={{ backgroundColor: ts.bg || 'var(--color-bg-secondary)', border: `1px solid ${ts.border || 'var(--color-border)'}` }}>
          {company.logo_url
            ? <img src={company.logo_url} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
            : <Building2 size={14} style={{ color: ts.color || 'var(--color-text-secondary)' }} />
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-text truncate leading-tight">{company.name}</span>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: company.is_active ? 'var(--color-success-500)' : 'var(--color-text-secondary)' }} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {company.slug && (
              <span className="text-[10px] font-mono text-text-secondary truncate max-w-[100px]">{company.slug}</span>
            )}
            {company.company_type && (
              <span className="text-[10px] font-semibold px-1.5 py-px rounded-md"
                style={{ backgroundColor: ts.bg, color: ts.color, border: `1px solid ${ts.border}` }}>
                {ts.label}
              </span>
            )}
          </div>
          {company.created_at && (
            <p className="text-[10px] text-text-secondary mt-0.5 opacity-70">
              {new Date(company.created_at).toLocaleDateString()}
            </p>
          )}
        </div>

        <ChevronRight size={13} className="flex-shrink-0 mt-1 transition-transform group-hover:translate-x-0.5"
          style={{ color: isSelected ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }} />
      </div>

      {/* action bar */}
      <div className="flex items-center px-2.5 pb-2" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onEdit(company)}
          className="flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all hover:bg-primary-50"
          style={{ color: 'var(--color-primary-600)' }}>
          <Edit2 size={10} className="inline mr-0.5 mb-px" /> Edit
        </button>
        <div className="w-px h-3 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />
        {company.is_active ? (
          <button
            onClick={() => { if (window.confirm(`Deactivate "${company.name}"? All users will be deactivated.`)) onDeactivate(company.id); }}
            className="flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all hover:bg-warning-50"
            style={{ color: 'var(--color-warning-600)' }}>
            <XCircle size={10} className="inline mr-0.5 mb-px" /> Deactivate
          </button>
        ) : (
          <button
            onClick={() => onActivate(company.id)}
            className="flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all hover:bg-success-50"
            style={{ color: 'var(--color-success-600)' }}>
            <CheckCircle size={10} className="inline mr-0.5 mb-px" /> Activate
          </button>
        )}
        <div className="w-px h-3 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />
        <button
          onClick={() => { if (window.confirm(`PERMANENTLY DELETE "${company.name}"?\n\nThis removes the company and all its users.\n\nThis cannot be undone.`)) onDelete(company.id); }}
          className="flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all hover:bg-error-50"
          style={{ color: 'var(--color-error-600)' }}>
          <Trash2 size={10} className="inline mr-0.5 mb-px" /> Delete
        </button>
      </div>
    </div>
  );
};

// ── SummaryPanel (right panel when nothing selected) ──────────────────────────
const SummaryPanel = ({ companies }) => {
  const stats = [
    { label: 'Total',    value: companies.length,                                  color: 'var(--color-text)'          },
    { label: 'Active',   value: companies.filter(c => c.is_active).length,         color: 'var(--color-success-600)'   },
    { label: 'Fronter',  value: companies.filter(c => c.company_type==='fronter').length, color: 'var(--color-success-600)' },
    { label: 'Closer',   value: companies.filter(c => c.company_type==='closer').length,  color: 'var(--color-primary-600)' },
  ];

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-8">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-primary-50)', border: '2px dashed var(--color-primary-200)' }}>
          <Building2 size={28} style={{ color: 'var(--color-primary-400)' }} />
        </div>
        <h3 className="text-lg font-bold text-text mb-1">Select a Company</h3>
        <p className="text-sm text-text-secondary max-w-xs leading-relaxed">
          Click any company in the list to view its details, members, roles, transfers, and more.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl p-4 text-center"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-text-secondary mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── sort chevron ───────────────────────────────────────────────────────────────
const SortBtn = ({ col, sort, onClick }) => (
  <button onClick={() => onClick(col)} className="flex items-center gap-0.5 text-[10px] text-text-secondary font-semibold hover:text-text transition-colors">
    {col === 'name' ? 'Name' : 'Date'}
    {sort.col !== col
      ? <ArrowUpDown size={9} className="opacity-40" />
      : sort.dir === 'asc' ? <ChevronUp size={9} /> : <ChevronDown size={9} />
    }
  </button>
);

// ── filter chip ────────────────────────────────────────────────────────────────
const Chip = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all border"
    style={{
      backgroundColor: active ? 'var(--color-primary-600)' : 'transparent',
      color:           active ? '#fff' : 'var(--color-text-secondary)',
      borderColor:     active ? 'var(--color-primary-600)' : 'var(--color-border)',
    }}>
    {children}
  </button>
);

// ── CompanyManagement ──────────────────────────────────────────────────────────
const CompanyManagement = () => {
  const {
    companies, loading, error,
    fetchCompanies, createCompany, updateCompany,
    deleteCompany, activateCompany, hardDeleteCompany,
  } = useCompanies();

  const [selected,    setSelected]    = useState(null);
  const [editModal,   setEditModal]   = useState(null);
  const [showCreate,  setShowCreate]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState('all');
  const [statusFilt,  setStatusFilt]  = useState('all');
  const [sort,        setSort]        = useState({ col: 'name', dir: 'asc' });

  useEffect(() => { fetchCompanies(); }, []);

  // Keep selected in sync after refetch
  useEffect(() => {
    if (!selected) return;
    const fresh = companies.find(c => c.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [companies]);

  const toggleSort = (col) =>
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });

  const counts = useMemo(() => ({
    fronter:  companies.filter(c => c.company_type === 'fronter').length,
    closer:   companies.filter(c => c.company_type === 'closer').length,
    active:   companies.filter(c => c.is_active).length,
    inactive: companies.filter(c => !c.is_active).length,
  }), [companies]);

  const filtered = useMemo(() => {
    let list = companies.filter(c => {
      if (search      && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeFilter !== 'all' && c.company_type !== typeFilter)               return false;
      if (statusFilt === 'active'   && !c.is_active) return false;
      if (statusFilt === 'inactive' &&  c.is_active) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const av = sort.col === 'name' ? (a.name || '').toLowerCase() : (a.created_at || '');
      const bv = sort.col === 'name' ? (b.name || '').toLowerCase() : (b.created_at || '');
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [companies, search, typeFilter, statusFilt, sort]);

  const handleSave = async (formData) => {
    try {
      if (editModal) {
        await updateCompany(editModal.id, {
          name: formData.name, slug: formData.slug || null,
          logo_url: formData.logo_url, company_type: formData.company_type,
        });
      } else {
        await createCompany(formData.name, formData.slug, formData.logo_url, formData.company_type);
      }
      setEditModal(null);
      setShowCreate(false);
      await fetchCompanies();
    } catch {}
  };

  const handleDeactivate = async (id) => { try { await deleteCompany(id); } catch {} };
  const handleActivate   = async (id) => { try { await activateCompany(id); } catch {} };
  const handleDelete     = async (id) => {
    try { await hardDeleteCompany(id); if (selected?.id === id) setSelected(null); } catch {}
  };

  return (
    <div className="h-full flex flex-col gap-3">

      {/* ── page header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-text">Companies</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            {filtered.length} of {companies.length} companies
            {selected && <span className="ml-2 font-semibold" style={{ color: 'var(--color-primary-600)' }}>· {selected.name}</span>}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <Plus size={14} /> Add Company
        </button>
      </div>

      {error && <Alert type="error" title="Error" message={error} className="flex-shrink-0" />}

      {/* ── split panel ─────────────────────────────────────────────── */}
      <div className="flex gap-0 flex-1 min-h-0 rounded-xl overflow-hidden border"
        style={{ borderColor: 'var(--color-border)' }}>

        {/* ──── LEFT: company list ──────────────────────────────────── */}
        <div className="w-72 xl:w-80 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>

          {/* list header: search + filters */}
          <div className="p-2.5 flex-shrink-0 space-y-2"
            style={{ borderBottom: '1px solid var(--color-border)' }}>

            {/* search */}
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-secondary)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search companies…"
                className="w-full pl-7 pr-2.5 text-xs rounded-lg border bg-surface text-text placeholder-text-secondary outline-none focus:ring-1 focus:ring-primary-400"
                style={{ height: 28, borderColor: 'var(--color-border)' }}
              />
            </div>

            {/* type filter */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-text-secondary font-medium w-10 flex-shrink-0">Type</span>
              <Chip active={typeFilter==='all'}     onClick={() => setTypeFilter('all')}>All</Chip>
              <Chip active={typeFilter==='fronter'} onClick={() => setTypeFilter('fronter')}>Fronter {counts.fronter}</Chip>
              <Chip active={typeFilter==='closer'}  onClick={() => setTypeFilter('closer')}>Closer {counts.closer}</Chip>
            </div>

            {/* status filter */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-text-secondary font-medium w-10 flex-shrink-0">Status</span>
              <Chip active={statusFilt==='all'}      onClick={() => setStatusFilt('all')}>All</Chip>
              <Chip active={statusFilt==='active'}   onClick={() => setStatusFilt('active')}>Active {counts.active}</Chip>
              <Chip active={statusFilt==='inactive'} onClick={() => setStatusFilt('inactive')}>Inactive {counts.inactive}</Chip>
            </div>

            {/* sort */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-secondary font-medium w-10 flex-shrink-0">Sort</span>
              <SortBtn col="name"    sort={sort} onClick={toggleSort} />
              <SortBtn col="created" sort={sort} onClick={toggleSort} />
            </div>
          </div>

          {/* list body */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <Building2 size={24} className="opacity-30" style={{ color: 'var(--color-text-secondary)' }} />
              <p className="text-xs text-text-secondary">No companies match the filters</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filtered.map(c => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  isSelected={selected?.id === c.id}
                  onSelect={setSelected}
                  onEdit={setEditModal}
                  onDeactivate={handleDeactivate}
                  onActivate={handleActivate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {/* footer count */}
          <div className="px-3 py-1.5 flex-shrink-0 flex items-center justify-between text-[10px] text-text-secondary"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            <span>{filtered.length} shown</span>
            <span>{counts.active} active · {counts.fronter} fronter · {counts.closer} closer</span>
          </div>
        </div>

        {/* ──── RIGHT: detail / empty ───────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg)' }}>
          {selected ? (
            <div className="p-5">
              <CompanyDetail
                key={selected.id}
                company={selected}
                onBack={() => setSelected(null)}
                onUpdate={setSelected}
              />
            </div>
          ) : (
            <SummaryPanel companies={companies} />
          )}
        </div>
      </div>

      {/* ── modals ──────────────────────────────────────────────────── */}
      {(showCreate || editModal) && (
        <CompanyModal
          company={editModal || null}
          onClose={() => { setShowCreate(false); setEditModal(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

export default CompanyManagement;
