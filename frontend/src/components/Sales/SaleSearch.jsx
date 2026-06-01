import React, { useState, useCallback, useRef } from 'react';
import { Search, X, User, Car, Hash, DollarSign, Calendar, Loader } from 'lucide-react';
import client from '../../api/client';
import { fmtSaleDate } from '../../utils/timezone';

const STATUS_COLOR = {
  sold:        { bg: '#dcfce7', color: '#16a34a', label: 'Sold'      },
  open:        { bg: '#dbeafe', color: '#2563eb', label: 'Pending'   },
  cancelled:   { bg: '#fee2e2', color: '#dc2626', label: 'Cancelled' },
  follow_up:   { bg: '#dbeafe', color: '#2563eb', label: 'Follow Up' },
  closed_won:  { bg: '#dcfce7', color: '#16a34a', label: 'Won'       },
  closed_lost: { bg: '#fee2e2', color: '#dc2626', label: 'Lost'      },
};

const StatusBadge = ({ status }) => {
  const s = STATUS_COLOR[status] || { bg: '#f1f5f9', color: '#64748b', label: status };
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
};

/**
 * SaleSearch — fast sale record lookup with debounced search.
 * Requires search_sales permission on the backend.
 */
const SaleSearch = ({ companyId, user }) => {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await client.get('sales/search', {
        params: { q: q.trim(), company_id: companyId },
      });
      setResults(res.data.sales || []);
      setSearched(true);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 200); // 200ms debounce
  };

  const clear = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
    setError('');
  };

  return (
    <div className="w-full">
      {/* Search bar */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          {loading
            ? <Loader size={18} className="animate-spin" style={{ color: 'var(--color-primary-500)' }} />
            : <Search size={18} style={{ color: 'var(--color-text-tertiary)' }} />
          }
        </div>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search by name, phone, reference no, VIN, email…"
          className="input pl-11 pr-10 text-sm h-12"
          style={{ fontSize: 15 }}
          autoComplete="off"
        />
        {query && (
          <button onClick={clear}
            className="absolute inset-y-0 right-0 pr-4 flex items-center"
            aria-label="Clear search">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {searched && results.length === 0 && !loading && (
        <div className="text-center py-10 text-text-secondary text-sm">
          No sales found for <strong>"{query}"</strong>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-text-tertiary mb-3">
            {results.length} result{results.length !== 1 ? 's' : ''} found
          </p>
          {results.map(s => (
            <div key={s.id}
              className="rounded-xl border p-4 transition-all duration-150 hover:shadow-md"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex items-start justify-between gap-3">
                {/* Left info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <User size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                    <p className="font-bold text-text truncate">{s.customer_name || '—'}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-secondary">
                    {s.customer_phone && <span>📞 {s.customer_phone}</span>}
                    {s.customer_email && <span>✉ {s.customer_email}</span>}
                  </div>
                  {s.car_year && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-text-secondary">
                      <Car size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                      {s.car_year} {s.car_make} {s.car_model}
                      {s.car_vin && <span className="font-mono ml-2 text-text-tertiary">{s.car_vin}</span>}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-text-tertiary">
                    {s.reference_no && (
                      <span className="flex items-center gap-1 font-mono font-semibold"
                        style={{ color: 'var(--color-primary-600)' }}>
                        <Hash size={11} />{s.reference_no}
                      </span>
                    )}
                    {s.plan && <span className="flex items-center gap-1"><span>📋</span> {s.plan}</span>}
                    {s.client_name && <span>Client: {s.client_name}</span>}
                    {s.sale_date && (
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {fmtSaleDate(s.sale_date)}
                      </span>
                    )}
                  </div>
                </div>
                {/* Right badges */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <StatusBadge status={s.status} />
                  {s.monthly_payment && (
                    <span className="text-xs font-bold text-success-600 flex items-center gap-0.5">
                      <DollarSign size={11} />{s.monthly_payment}/mo
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SaleSearch;
