import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Search, Building2, MoreVertical,
  Edit2, XCircle, CheckCircle, Trash2,
  ArrowUpDown, ChevronUp, ChevronDown, GripVertical,
} from 'lucide-react';
import { Alert } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';
import client from '../../../api/client';
import CompanyModal from './CompanyModal';
import CompanyDetail from './CompanyDetail';

// Per-user preference key for the superadmin's custom company ordering.
// Persisted via /user-preferences and reused across sessions / devices.
const ORDER_PREF_KEY = 'companies.order';

// ── type style map ─────────────────────────────────────────────────────────────
const TYPE = {
  fronter: { bg: 'var(--color-success-50)',  color: 'var(--color-success-700)',  border: 'var(--color-success-200)',  label: 'Fronter' },
  closer:  { bg: 'var(--color-primary-50)', color: 'var(--color-primary-700)', border: 'var(--color-primary-200)', label: 'Closer'  },
};

// ── CompanyCard ────────────────────────────────────────────────────────────────
// `draggable` toggles the grip handle + native HTML5 drag events. The wrapper
// adds the dnd handlers only when in custom-sort mode so name / date sort
// stays static and accidental drags don't reorder a list the user can't save.
const CompanyCard = ({ company, isSelected, onSelect, onEdit, onDeactivate, onActivate, onDelete, draggable, dragHandlers }) => {
  const ts = TYPE[company.company_type] || {};
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos,  setMenuPos]  = useState({ top: 0, left: 0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = (e) => {
    e.stopPropagation();
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 152 });
    setMenuOpen(o => !o);
  };

  return (
    <div
      onClick={() => onSelect(company)}
      draggable={draggable}
      onDragStart={dragHandlers?.onDragStart}
      onDragOver={dragHandlers?.onDragOver}
      onDrop={dragHandlers?.onDrop}
      onDragEnd={dragHandlers?.onDragEnd}
      className="rounded-xl border cursor-pointer transition-all group"
      style={{
        borderColor: isSelected ? 'var(--color-primary-500)' : 'var(--color-border)',
        backgroundColor: isSelected ? 'var(--color-primary-50)' : 'var(--color-surface)',
        boxShadow: isSelected ? '0 0 0 1px var(--color-primary-500)' : 'none',
      }}
    >
      <div className="flex items-start gap-2.5 p-2.5">
        {draggable && (
          /* Grip handle — pure visual cue. native drag fires from any child,
             so a click directly on the icon doesn't accidentally select the card. */
          <div className="flex items-center justify-center w-4 flex-shrink-0 cursor-grab active:cursor-grabbing"
            style={{ color: 'var(--color-text-tertiary)' }}
            onClick={e => e.stopPropagation()}>
            <GripVertical size={14} />
          </div>
        )}
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

        <button
          ref={btnRef}
          onClick={openMenu}
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/5 transition-colors mt-0.5"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <MoreVertical size={13} />
        </button>
      </div>

      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="rounded-xl border overflow-hidden py-1"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 9999,
            width: 152,
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => { setMenuOpen(false); onEdit(company); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-primary-50 transition-colors"
            style={{ color: 'var(--color-primary-600)' }}
          >
            <Edit2 size={11} /> Edit
          </button>
          {company.is_active ? (
            <button
              onClick={() => { setMenuOpen(false); if (window.confirm(`Deactivate "${company.name}"? All users will be deactivated.`)) onDeactivate(company.id); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-warning-50 transition-colors"
              style={{ color: 'var(--color-warning-600)' }}
            >
              <XCircle size={11} /> Deactivate
            </button>
          ) : (
            <button
              onClick={() => { setMenuOpen(false); onActivate(company.id); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-success-50 transition-colors"
              style={{ color: 'var(--color-success-600)' }}
            >
              <CheckCircle size={11} /> Activate
            </button>
          )}
          <div className="my-1 mx-3 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
          <button
            onClick={() => { setMenuOpen(false); if (window.confirm(`PERMANENTLY DELETE "${company.name}"?\n\nThis removes the company and all its users.\n\nThis cannot be undone.`)) onDelete(company.id); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-error-50 transition-colors"
            style={{ color: 'var(--color-error-600)' }}
          >
            <Trash2 size={11} /> Delete
          </button>
        </div>,
        document.body
      )}
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
const SortBtn = ({ col, sort, onClick, label }) => {
  const active = sort.col === col;
  const showDir = active && col !== 'custom';   // custom has no asc/desc, just on/off
  return (
    <button onClick={() => onClick(col)}
      className="flex items-center gap-0.5 text-[10px] font-semibold transition-colors"
      style={{
        color: active ? 'var(--color-primary-700)' : 'var(--color-text-secondary)',
      }}>
      {label || (col === 'name' ? 'Name' : col === 'custom' ? 'Custom' : 'Date')}
      {col === 'custom'
        ? <GripVertical size={9} className={active ? '' : 'opacity-40'} />
        : showDir
          ? (sort.dir === 'asc' ? <ChevronUp size={9} /> : <ChevronDown size={9} />)
          : <ArrowUpDown size={9} className="opacity-40" />}
    </button>
  );
};

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

  // Per-user custom ordering — an array of company IDs in display order.
  // Loaded once on mount from /user-preferences and re-saved after every
  // drag-drop. Missing IDs (companies added after the pref was saved) fall
  // through to the end of the list in name order so a fresh company doesn't
  // get hidden by a stale preference.
  const [customOrder, setCustomOrder] = useState([]);
  const dragId = useRef(null);

  useEffect(() => { fetchCompanies(); }, []);

  // Hydrate the saved order. Server returns `value: null` when no pref exists
  // for this user yet, which we treat as an empty array (no custom sort).
  useEffect(() => {
    client.get(`user-preferences/${ORDER_PREF_KEY}`)
      .then(r => { if (Array.isArray(r.data?.value)) setCustomOrder(r.data.value); })
      .catch(() => {});
  }, []);

  // Save the order back to the server. Fire-and-forget — local state already
  // reflects the new order; server-side failure surfaces via the existing
  // Alert on the next refetch, not via a blocking spinner during drag.
  const persistOrder = useCallback((next) => {
    setCustomOrder(next);
    client.put(`user-preferences/${ORDER_PREF_KEY}`, { value: next }).catch(() => {});
  }, []);

  // Drag handlers — HTML5 native, no library. The currently-dragged company
  // ID lives in a ref so we can do a single state update on drop instead of
  // one per onDragOver tick. Reorder is in-place: drop on a target slides
  // the dragged card into that slot. Only triggered in custom-sort mode so
  // the handlers in CompanyCard receive undefined otherwise (no-op).
  const onDragStart = (id) => (e) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop      = (targetId) => (e) => {
    e.preventDefault();
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === targetId) return;
    // Start from the displayed `filtered` order so dropping is intuitive even
    // when filters hide some companies. Anything outside `filtered` keeps
    // its current relative slot in the persisted order.
    const visibleIds = filteredRef.current.map(c => c.id);
    const srcIdx = visibleIds.indexOf(src);
    const tgtIdx = visibleIds.indexOf(targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    const newVisible = [...visibleIds];
    newVisible.splice(srcIdx, 1);
    newVisible.splice(tgtIdx, 0, src);

    // Merge: visible-in-new-order first, then any prior-order IDs that
    // weren't in the visible set so hidden companies don't get scrambled.
    const prevOrder = customOrder.length ? customOrder : companies.map(c => c.id);
    const visibleSet = new Set(newVisible);
    const merged = [...newVisible, ...prevOrder.filter(id => !visibleSet.has(id))];
    persistOrder(merged);
  };
  const onDragEnd = () => { dragId.current = null; };

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

    if (sort.col === 'custom') {
      // Index lookup from the saved preference; anything missing (newly
      // created company never dragged) gets a slot past the known order so
      // it appears at the end instead of being hidden by the comparator.
      const idx = new Map(customOrder.map((id, i) => [id, i]));
      return [...list].sort((a, b) => {
        const ai = idx.has(a.id) ? idx.get(a.id) : Number.MAX_SAFE_INTEGER;
        const bi = idx.has(b.id) ? idx.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    return [...list].sort((a, b) => {
      const av = sort.col === 'name' ? (a.name || '').toLowerCase() : (a.created_at || '');
      const bv = sort.col === 'name' ? (b.name || '').toLowerCase() : (b.created_at || '');
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [companies, search, typeFilter, statusFilt, sort, customOrder]);

  // Mirror `filtered` to a ref so onDrop can read the displayed order without
  // closing over a stale snapshot from the time the handler was bound.
  const filteredRef = useRef(filtered);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);

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
    <div className="h-full flex flex-col">

      {error && <Alert type="error" title="Error" message={error} className="flex-shrink-0 mb-2" />}

      {/* ── split panel ─────────────────────────────────────────────── */}
      <div className="flex gap-0 flex-1 min-h-0 rounded-xl overflow-hidden border"
        style={{ borderColor: 'var(--color-border)' }}>

        {/* ──── LEFT: company list ──────────────────────────────────── */}
        <div className="w-72 xl:w-80 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>

          {/* list header: search + filters */}
          <div className="p-2.5 flex-shrink-0 space-y-2"
            style={{ borderBottom: '1px solid var(--color-border)' }}>

            {/* search + add button */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
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
              <button
                onClick={() => setShowCreate(true)}
                title="Add Company"
                className="flex items-center justify-center w-7 h-7 rounded-lg text-white flex-shrink-0 transition-opacity hover:opacity-85"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <Plus size={13} />
              </button>
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
              {/* Custom: enables drag-and-drop reordering. The order persists
                  per superadmin via /user-preferences (mig 065). */}
              <SortBtn col="custom"  sort={sort} onClick={() => setSort({ col: 'custom', dir: 'asc' })} />
            </div>
            {sort.col === 'custom' && (
              <p className="text-[10px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                Drag the grip handle to reorder. Saved automatically.
              </p>
            )}
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
                  draggable={sort.col === 'custom'}
                  dragHandlers={sort.col === 'custom' ? {
                    onDragStart: onDragStart(c.id),
                    onDragOver,
                    onDrop: onDrop(c.id),
                    onDragEnd,
                  } : undefined}
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
