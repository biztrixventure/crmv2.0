import { useState } from 'react';
import { Search, Phone, DollarSign, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { Card, Badge } from '../UI';
import client from '../../api/client';

const TRANSFER_BADGE = {
  pending:   'warning',
  assigned:  'info',
  completed: 'success',
  cancelled: 'error',
  rejected:  'error',
};

const SALE_CONFIG = {
  open:             { label: 'Sale Open',       color: '#2563eb', bg: '#dbeafe',  icon: Clock        },
  sold:             { label: 'Sold',            color: '#16a34a', bg: '#dcfce7',  icon: CheckCircle  },
  pending_review:   { label: 'In Review',       color: '#d97706', bg: '#fef3c7',  icon: Clock        },
  needs_revision:   { label: 'Needs Revision',  color: '#dc2626', bg: '#fee2e2',  icon: AlertTriangle},
  closed_won:       { label: 'Approved',        color: '#16a34a', bg: '#dcfce7',  icon: CheckCircle  },
  closed_lost:      { label: 'Lost',            color: '#6b7280', bg: '#f3f4f6',  icon: XCircle      },
  follow_up:        { label: 'Follow Up',       color: '#8b5cf6', bg: '#ede9fe',  icon: Clock        },
  cancelled:        { label: 'Cancelled',       color: '#6b7280', bg: '#f3f4f6',  icon: XCircle      },
};

const SaleStatusBadge = ({ status }) => {
  const cfg = SALE_CONFIG[status] || { label: status, color: '#6b7280', bg: '#f3f4f6', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
};

const TransferCard = ({ transfer, onCreateSale }) => {
  const fd           = transfer.form_data || {};
  const customerName = fd.customer_name
    || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : null)
    || 'Unknown';
  const phone = fd.customer_phone || fd.Phone || '—';

  const skipKeys = new Set(['customer_name', 'customer_phone', 'FirstName', 'LastName', 'Phone']);
  const extraFields = Object.entries(fd)
    .filter(([k, v]) => v && !skipKeys.has(k))
    .slice(0, 4);

  const hasSale = transfer.has_sale;
  const saleStatus = transfer.sale_status;
  const isFinalised = hasSale && ['closed_won', 'sold', 'closed_lost', 'cancelled'].includes(saleStatus);
  const needsRevision = hasSale && saleStatus === 'needs_revision';

  return (
    <div className="rounded-xl border px-3 py-2.5 animate-fade-in"
      style={{
        borderColor: needsRevision ? 'var(--color-error-300)' : hasSale ? 'var(--color-success-300)' : 'var(--color-border)',
        backgroundColor: needsRevision ? 'var(--color-error-50)' : hasSale ? 'var(--color-success-50, #f0fdf4)' : 'var(--color-bg)',
      }}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {/* Company + status row */}
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span
              className="px-1.5 py-0 rounded text-xs font-bold uppercase tracking-wider"
              style={{
                backgroundColor: 'var(--color-primary-100)',
                color: 'var(--color-primary-700)',
                border: '1px solid var(--color-primary-200)',
              }}
            >
              {transfer.company_slug}
            </span>
            <Badge variant={TRANSFER_BADGE[transfer.status] || 'secondary'} size="sm">
              {transfer.status}
            </Badge>
            {hasSale && <SaleStatusBadge status={saleStatus} />}
            <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
              {new Date(transfer.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>

          {/* Name + phone on one line */}
          <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--color-text)' }}>
            {customerName}
            <span className="font-normal ml-2" style={{ color: 'var(--color-text-secondary)' }}>{phone}</span>
          </p>

          {/* Extra fields compact */}
          {extraFields.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {extraFields.map(([key, val]) => (
                <span key={key} className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  <span className="capitalize">{key.replace(/_/g, ' ')}</span>: <span style={{ color: 'var(--color-text-secondary)' }}>{String(val)}</span>
                </span>
              ))}
            </div>
          )}

          {transfer.fronter_name && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
              By: {transfer.fronter_name}
            </p>
          )}

          {/* Sale reference + closer info */}
          {hasSale && transfer.sale_reference_no && (
            <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
              Ref: {transfer.sale_reference_no}
              {transfer.sale_closer_name && ` · Closer: ${transfer.sale_closer_name}`}
            </p>
          )}

          {/* Compliance note if needs revision */}
          {needsRevision && transfer.sale_compliance_note && (
            <div className="mt-1.5 px-2 py-1 rounded-lg flex items-start gap-1.5"
              style={{ backgroundColor: 'var(--color-error-100)', border: '1px solid var(--color-error-200)' }}>
              <AlertTriangle size={11} style={{ color: 'var(--color-error-600)', marginTop: 1, flexShrink: 0 }} />
              <p className="text-xs" style={{ color: 'var(--color-error-700)' }}>
                {transfer.sale_compliance_note}
              </p>
            </div>
          )}
        </div>

        {/* Action */}
        <div className="flex-shrink-0">
          {hasSale ? (
            <span className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
              <DollarSign size={11} /> Already Sold
            </span>
          ) : (
            <button
              onClick={() => {
                const fd = transfer.form_data || {};
                // Best-effort name: try all common field name patterns
                const resolvedName = customerName !== 'Unknown'
                  ? customerName
                  : (fd.customer_name || fd.Name || fd.name || fd.FullName || fd.fullname
                     || Object.values(fd).find(v => typeof v === 'string' && v.length > 1 && !/\d{5,}/.test(v)) || '');
                const resolvedPhone = phone !== '—' ? phone : (fd.customer_phone || fd.Phone || fd.phone || '');
                onCreateSale({
                  ...transfer,
                  form_data: { ...fd, customer_name: resolvedName, customer_phone: resolvedPhone },
                });
              }}
              className="flex items-center gap-1 py-1.5 px-3 rounded-lg font-semibold text-xs text-white
                         hover:scale-[1.03] transition-all"
              style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap' }}
            >
              <DollarSign size={12} /> Sale
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const PhoneSearch = ({ onCreateSale }) => {
  const [phone,   setPhone]   = useState('');
  const [results, setResults] = useState(null); // null = not yet searched
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = phone.trim();
    if (q.length < 3) { setError('Enter at least 3 characters.'); return; }
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const res = await client.get('transfers/search-by-phone', { params: { phone: q } });
      setResults(res.data.transfers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const alreadySoldCount = (results || []).filter(t => t.has_sale).length;
  const availableCount   = (results || []).filter(t => !t.has_sale).length;

  return (
    <Card className="p-4">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2 items-center">
        <Search size={15} className="flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
        <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>Search Lead</span>
        <div className="flex-1 relative">
          <Phone
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-text-tertiary)' }}
          />
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="Phone number…"
            className="input pl-8 w-full text-sm h-9"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-1.5 py-2 px-4 rounded-lg font-semibold text-sm text-white disabled:opacity-50
                     hover:scale-[1.02] transition-all flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
        >
          {loading
            ? <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
            : <Search size={14} />}
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && (
        <p className="text-xs mt-2 ml-1" style={{ color: 'var(--color-error-600)' }}>{error}</p>
      )}

      {/* Results */}
      {results !== null && (
        results.length === 0 ? (
          <p className="text-sm text-center mt-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>
            No transfers found for that number.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {results.length} record{results.length !== 1 ? 's' : ''} found
              </p>
              {alreadySoldCount > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>
                  {alreadySoldCount} already sold
                </span>
              )}
              {availableCount > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
                  {availableCount} available
                </span>
              )}
            </div>
            {results.map(t => (
              <TransferCard key={t.id} transfer={t} onCreateSale={onCreateSale} />
            ))}
          </div>
        )
      )}
    </Card>
  );
};

export default PhoneSearch;
