import React, { useState } from 'react';
import { Edit2, Trash2, Eye, CheckCircle, XCircle, ChevronUp, ChevronDown, ChevronsUpDown, Building2, Users } from 'lucide-react';
import { Card } from '../../../components/UI';

const SortIcon = ({ col, sort }) => {
  if (sort.col !== col) return <ChevronsUpDown size={11} className="opacity-30" />;
  return sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
};

const TYPE_STYLES = {
  fronter: { bg: 'var(--color-success-50)',  color: 'var(--color-success-700)',  border: 'var(--color-success-200)'  },
  closer:  { bg: 'var(--color-primary-50)', color: 'var(--color-primary-700)', border: 'var(--color-primary-200)' },
};

const CompanyList = ({ companies, onEdit, onDeactivate, onActivate, onHardDelete, onView }) => {
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });

  const toggleSort = (col) => {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  const sorted = [...(companies || [])].sort((a, b) => {
    let av, bv;
    if (sort.col === 'name')    { av = a.name?.toLowerCase() || ''; bv = b.name?.toLowerCase() || ''; }
    if (sort.col === 'type')    { av = a.company_type || ''; bv = b.company_type || ''; }
    if (sort.col === 'status')  { av = a.is_active ? 1 : 0; bv = b.is_active ? 1 : 0; }
    if (sort.col === 'created') { av = a.created_at || ''; bv = b.created_at || ''; }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ?  1 : -1;
    return 0;
  });

  if (!companies || companies.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Building2 size={32} className="mx-auto mb-2 text-text-secondary opacity-40" />
        <p className="text-text-secondary text-sm">No companies found</p>
      </Card>
    );
  }

  const thCls = "px-3 py-2 text-left text-xs font-bold text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:text-text transition-colors";

  return (
    <Card variant="outlined" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              <th className={thCls} onClick={() => toggleSort('name')}>
                <span className="flex items-center gap-1">Company <SortIcon col="name" sort={sort} /></span>
              </th>
              <th className={thCls} onClick={() => toggleSort('type')}>
                <span className="flex items-center gap-1">Type <SortIcon col="type" sort={sort} /></span>
              </th>
              <th className={thCls} onClick={() => toggleSort('status')}>
                <span className="flex items-center gap-1">Status <SortIcon col="status" sort={sort} /></span>
              </th>
              <th className={thCls} onClick={() => toggleSort('created')}>
                <span className="flex items-center gap-1">Created <SortIcon col="created" sort={sort} /></span>
              </th>
              <th className="px-3 py-2 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(company => {
              const typeStyle = TYPE_STYLES[company.company_type] || {};
              return (
                <tr key={company.id} onClick={() => onView(company)}
                  className="transition-colors hover:bg-bg-secondary cursor-pointer group"
                  style={{ borderBottom: '1px solid var(--color-border)' }}>

                  {/* Name */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {company.logo_url ? (
                        <img src={company.logo_url} alt={company.name}
                          className="w-6 h-6 rounded object-cover flex-shrink-0"
                          onError={e => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: typeStyle.bg || 'var(--color-bg-secondary)' }}>
                          <Building2 size={12} style={{ color: typeStyle.color || 'var(--color-text-secondary)' }} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-text text-sm truncate">{company.name}</div>
                        {company.slug && <div className="text-xs text-text-secondary font-mono truncate">{company.slug}</div>}
                      </div>
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2">
                    {company.company_type ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border"
                        style={{ backgroundColor: typeStyle.bg, color: typeStyle.color, borderColor: typeStyle.border }}>
                        {company.company_type === 'fronter' ? 'Fronter' : 'Closer'}
                      </span>
                    ) : <span className="text-text-secondary text-xs">—</span>}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border"
                      style={company.is_active
                        ? { backgroundColor: 'var(--color-success-50)', color: 'var(--color-success-700)', borderColor: 'var(--color-success-200)' }
                        : { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }
                      }>
                      <span className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: company.is_active ? 'var(--color-success-500)' : 'var(--color-text-secondary)' }} />
                      {company.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  {/* Created */}
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {company.created_at ? new Date(company.created_at).toLocaleDateString() : '—'}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => onView(company)}
                        className="p-1.5 rounded-lg transition-all hover:bg-bg-secondary"
                        style={{ color: 'var(--color-text-secondary)' }} title="View details">
                        <Eye size={13} />
                      </button>
                      <button onClick={() => onEdit(company)}
                        className="p-1.5 rounded-lg transition-all hover:bg-primary-50"
                        style={{ color: 'var(--color-primary-600)' }} title="Edit company">
                        <Edit2 size={13} />
                      </button>
                      {company.is_active ? (
                        <button
                          onClick={() => { if (window.confirm(`Deactivate "${company.name}"? All users will be deactivated.`)) onDeactivate(company.id); }}
                          className="p-1.5 rounded-lg transition-all hover:bg-warning-50"
                          style={{ color: 'var(--color-warning-600)' }} title="Deactivate">
                          <XCircle size={13} />
                        </button>
                      ) : (
                        <button onClick={() => onActivate(company.id)}
                          className="p-1.5 rounded-lg transition-all hover:bg-success-50"
                          style={{ color: 'var(--color-success-600)' }} title="Activate">
                          <CheckCircle size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => { if (window.confirm(`PERMANENTLY DELETE "${company.name}"?\n\nThis will remove the company and all its users. Sales and transfers will be kept but unlinked.\n\nThis cannot be undone.`)) onHardDelete(company.id); }}
                        className="p-1.5 rounded-lg transition-all hover:bg-error-50"
                        style={{ color: 'var(--color-error-600)' }} title="Permanently delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      <div className="px-3 py-2 flex items-center gap-3 text-xs text-text-secondary"
        style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <span>{sorted.length} {sorted.length === 1 ? 'company' : 'companies'}</span>
        <span className="w-px h-3 bg-border" />
        <span>{sorted.filter(c => c.company_type === 'fronter').length} fronter</span>
        <span className="w-px h-3 bg-border" />
        <span>{sorted.filter(c => c.company_type === 'closer').length} closer</span>
        <span className="w-px h-3 bg-border" />
        <span>{sorted.filter(c => c.is_active).length} active</span>
      </div>
    </Card>
  );
};

export default CompanyList;
