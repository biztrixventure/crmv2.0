import { useState } from 'react';
import { Search, Phone, DollarSign, Clock } from 'lucide-react';
import { Card, Badge } from '../UI';
import client from '../../api/client';

const TRANSFER_BADGE = {
  pending:   'warning',
  assigned:  'info',
  completed: 'success',
  cancelled: 'error',
  rejected:  'error',
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

  return (
    <div className="rounded-xl border px-3 py-2.5 animate-fade-in"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
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
        </div>

        {/* Create Sale action */}
        <div className="flex-shrink-0">
          <button
            onClick={() => onCreateSale(transfer)}
            className="flex items-center gap-1 py-1.5 px-3 rounded-lg font-semibold text-xs text-white
                       hover:scale-[1.03] transition-all"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap' }}
          >
            <DollarSign size={12} /> Sale
          </button>
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
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {results.length} record{results.length !== 1 ? 's' : ''} — most recent first
            </p>
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
