import React from 'react';
import { Edit2, Trash2, Eye, CheckCircle, XCircle, Building2, Users } from 'lucide-react';
import { Card } from '../../../components/UI';
import { TableScroll } from "../../UI/kit";
import ColumnHeader from '../../UI/ColumnHeader';
import { useTableQuery } from '../../../hooks/useTableQuery';
import { clientColumns } from '../../../utils/clientColumns';

const TYPE_STYLES = {
  fronter: { bg: 'var(--color-success-50)',  color: 'var(--color-success-700)',  border: 'var(--color-success-200)'  },
  closer:  { bg: 'var(--color-primary-50)', color: 'var(--color-primary-700)', border: 'var(--color-primary-200)' },
};

// Client mode: this component is handed the WHOLE company list as a prop (six
// rows in production), so a round-trip per keystroke would be the regression,
// not the fix. Same headers and same menus as the server-backed tabs.
const COLUMNS = clientColumns({
  name:    'text',
  type:    { type: 'enum', values: ['fronter', 'closer'] },
  status:  'bool',
  created: 'date',
});
const TYPE_OPTIONS = [{ value: 'fronter', label: 'Fronter' }, { value: 'closer', label: 'Closer' }];

// The uiKeys above are the header labels; the rows carry schema names. One
// accessor maps between them, so the catalog reads like the header row.
const accessor = (row, key) => {
  if (key === 'name')    return row?.name;
  if (key === 'type')    return row?.company_type;
  if (key === 'status')  return !!row?.is_active;
  if (key === 'created') return row?.created_at;
  return row?.[key];
};

const CompanyList = ({ companies, onEdit, onDeactivate, onActivate, onHardDelete, onView }) => {
  const tq = useTableQuery({
    scope: 'admin:companies',
    mode: 'client',
    columns: COLUMNS,
    defaultSort: { by: 'name', dir: 'asc' },   // unchanged from the old local sort
    accessor,
  });

  const sorted = tq.apply(companies || []);

  if (!companies || companies.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Building2 size={32} className="mx-auto mb-2 text-text-secondary opacity-40" />
        <p className="text-text-secondary text-sm">No companies found</p>
      </Card>
    );
  }

  // No cursor-pointer on the cell any more: ColumnHeader puts the click targets
  // on its own label button and filter chip, so painting the whole <th> as
  // clickable would promise a hit area that no longer exists.
  const thCls = "px-3 py-2 text-left text-xs font-bold text-text-secondary uppercase tracking-wider select-none";

  return (
    <Card variant="outlined" className="overflow-hidden">
      <TableScroll stickyFirst label="Companies">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              <ColumnHeader tq={tq} colKey="name"    label="Company" className={thCls} />
              <ColumnHeader tq={tq} colKey="type"    label="Type"    className={thCls} options={TYPE_OPTIONS} />
              <ColumnHeader tq={tq} colKey="status"  label="Status"  className={thCls} />
              <ColumnHeader tq={tq} colKey="created" label="Created" className={thCls} />
              {/* No catalog entry → an inert header, exactly as in server mode. */}
              <th className="px-3 py-2 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* The card-level empty state above is gated on `companies`, so the
                headers survive a filter that matches nothing — this row is what
                explains the blank table and offers the way out. */}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  No companies match the column filters.{' '}
                  <button onClick={tq.clearAll} className="font-semibold underline" style={{ color: 'var(--color-primary-600)' }}>
                    Clear filters
                  </button>
                </td>
              </tr>
            )}
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
      </TableScroll>

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
