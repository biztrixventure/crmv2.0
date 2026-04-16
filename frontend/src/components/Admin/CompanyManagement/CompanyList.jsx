import React from 'react';
import { Edit2, Trash2, Eye, CheckCircle, XCircle } from 'lucide-react';
import { Badge, Card } from '../../../components/UI';

const CompanyList = ({ companies, onEdit, onDeactivate, onActivate, onHardDelete, onView, loading = false }) => {
  if (!companies || companies.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No companies found</p>
      </Card>
    );
  }

  return (
    <Card variant="outlined" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Company', 'Status', 'Created', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map(company => (
              <tr key={company.id}
                className="transition-colors hover:bg-bg-secondary"
                style={{ borderBottom: '1px solid var(--color-border)' }}>

                {/* Name */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {company.logo_url && (
                      <img src={company.logo_url} alt={company.name}
                        className="w-8 h-8 rounded object-cover"
                        onError={e => { e.target.style.display = 'none'; }} />
                    )}
                    <span className="font-semibold text-text">{company.name}</span>
                  </div>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <Badge variant={company.is_active ? 'success' : 'secondary'} size="sm">
                    {company.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>

                {/* Created */}
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {company.created_at ? new Date(company.created_at).toLocaleDateString() : '—'}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    {/* View */}
                    <button onClick={() => onView(company)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-bg-secondary"
                      style={{ color: 'var(--color-text-secondary)' }}
                      title="View details">
                      <Eye size={13} /> View
                    </button>

                    {/* Edit */}
                    <button onClick={() => onEdit(company)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-bg-secondary"
                      style={{ color: 'var(--color-primary-600)' }}
                      title="Edit company">
                      <Edit2 size={13} /> Edit
                    </button>

                    {/* Activate / Deactivate toggle */}
                    {company.is_active ? (
                      <button
                        onClick={() => {
                          if (window.confirm(`Deactivate "${company.name}"? All users will be deactivated.`)) {
                            onDeactivate(company.id);
                          }
                        }}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-warning-50"
                        style={{ color: 'var(--color-warning-600)' }}
                        title="Deactivate company">
                        <XCircle size={13} /> Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => onActivate(company.id)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-success-50"
                        style={{ color: 'var(--color-success-600)' }}
                        title="Activate company">
                        <CheckCircle size={13} /> Activate
                      </button>
                    )}

                    {/* Hard Delete */}
                    <button
                      onClick={() => {
                        if (window.confirm(`PERMANENTLY DELETE "${company.name}"?\n\nThis will remove the company and all its users. Sales and transfers will be kept but unlinked.\n\nThis cannot be undone.`)) {
                          onHardDelete(company.id);
                        }
                      }}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-error-50"
                      style={{ color: 'var(--color-error-600)' }}
                      title="Permanently delete company">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default CompanyList;
