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

  // All form_data fields except name/phone (already shown prominently)
  const skipKeys = new Set(['customer_name', 'customer_phone', 'FirstName', 'LastName', 'Phone']);
  const extraFields = Object.entries(fd)
    .filter(([k, v]) => v && !skipKeys.has(k))
    .slice(0, 8);

  return (
    <Card className="p-5 animate-fade-in">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* Company slug + status + date */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span
              className="px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-widest"
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
            <span className="flex items-center gap-1 text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
              <Clock size={11} />
              {new Date(transfer.created_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>

          {/* Customer */}
          <p className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>{customerName}</p>
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            <Phone size={12} style={{ display: 'inline', marginRight: 4 }} />
            {phone}
          </p>

          {/* Form data fields */}
          {extraFields.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mt-2 pt-2"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              {extraFields.map(([key, val]) => (
                <div key={key}>
                  <p className="text-xs capitalize" style={{ color: 'var(--color-text-tertiary)' }}>
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                    {String(val)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {transfer.fronter_name && (
            <p className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Added by: {transfer.fronter_name}
            </p>
          )}
        </div>

        {/* Create Sale action */}
        <div className="flex-shrink-0 pt-1">
          <button
            onClick={() => onCreateSale(transfer)}
            className="flex items-center gap-1.5 py-2.5 px-4 rounded-xl font-semibold text-sm text-white
                       hover:scale-[1.03] transition-all"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap' }}
          >
            <DollarSign size={14} /> Create Sale
          </button>
        </div>
      </div>
    </Card>
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
    <div>
      {/* Search input */}
      <Card className="p-6 mb-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Search size={20} style={{ color: 'var(--color-primary-600)' }} />
          Search by Phone Number
        </h3>
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="flex-1 relative">
            <Phone
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-text-tertiary)' }}
            />
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Enter phone number…"
              className="input pl-9 w-full"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 py-2 px-6 rounded-xl font-bold text-white disabled:opacity-50
                       hover:scale-[1.02] transition-all"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
          >
            {loading
              ? <><div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Searching…</>
              : <><Search size={16} /> Search</>}
          </button>
        </form>
        {error && (
          <p className="text-sm mt-2" style={{ color: 'var(--color-error-600)' }}>{error}</p>
        )}
      </Card>

      {/* Results */}
      {results !== null && (
        results.length === 0 ? (
          <Card className="p-10 text-center">
            <Phone size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
            <p style={{ color: 'var(--color-text-secondary)' }}>No transfers found for that number.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {results.length} record{results.length !== 1 ? 's' : ''} found — most recent first
            </p>
            {results.map(t => (
              <TransferCard key={t.id} transfer={t} onCreateSale={onCreateSale} />
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default PhoneSearch;
