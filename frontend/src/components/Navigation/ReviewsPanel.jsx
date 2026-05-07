import { useState, useCallback, useEffect } from 'react';
import { Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, SmartText } from '../UI';
import client from '../../api/client';

const PAGE_SIZE = 25;
const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };
const RATINGS = ['excellent', 'good', 'average', 'below_average', 'bad'];
const DISPOS  = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];

const Pagination = ({ page, total, pageSize, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4 border-t px-4 pb-4" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg border disabled:opacity-40 hover:bg-bg-secondary transition-colors"
          style={{ borderColor: 'var(--color-border)' }}>
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg border disabled:opacity-40 hover:bg-bg-secondary transition-colors"
          style={{ borderColor: 'var(--color-border)' }}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

const ReviewsPanel = ({ companyId, agents = [] }) => {
  const [reviews,      setReviews]      = useState([]);
  const [dispos,       setDispos]       = useState([]);
  const [reviewTotal,  setReviewTotal]  = useState(0);
  const [dispoTotal,   setDispoTotal]   = useState(0);
  const [reviewPage,   setReviewPage]   = useState(1);
  const [dispoPage,    setDispoPage]    = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [subTab,       setSubTab]       = useState('ratings');
  const [agentFilter,  setAgentFilter]  = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [dispoFilter,  setDispoFilter]  = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const rParams = { company_id: companyId, limit: PAGE_SIZE, page: reviewPage };
      if (agentFilter)  rParams.closer_id = agentFilter;
      if (ratingFilter) rParams.rating    = ratingFilter;

      const dParams = { company_id: companyId, limit: PAGE_SIZE, page: dispoPage };
      if (agentFilter) dParams.closer_id    = agentFilter;
      if (dispoFilter) dParams.disposition  = dispoFilter;

      const [rRes, dRes] = await Promise.all([
        client.get('reviews',              { params: rParams }),
        client.get('reviews/dispositions', { params: dParams }),
      ]);
      setReviews(rRes.data.reviews       || []);
      setReviewTotal(rRes.data.total     || 0);
      setDispos(dRes.data.dispositions   || []);
      setDispoTotal(dRes.data.total      || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId, reviewPage, dispoPage, agentFilter, ratingFilter, dispoFilter]);

  useEffect(() => { load(); }, [load]);

  const handleAgentChange  = (v) => { setAgentFilter(v);  setReviewPage(1); setDispoPage(1); };
  const handleRatingChange = (v) => { setRatingFilter(v); setReviewPage(1); };
  const handleDispoChange  = (v) => { setDispoFilter(v);  setDispoPage(1); };

  const selectCls = 'input py-1.5 text-sm h-auto';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4 animate-fade-in">
      <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
        <Star size={22} style={{ color: 'var(--color-primary-600)' }} />
        Call Reviews
      </h2>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[{ key: 'ratings', label: 'Call Ratings' }, { key: 'dispos', label: 'Dispositions' }].map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: subTab === t.key ? 'var(--color-surface)'      : 'transparent',
                color:            subTab === t.key ? 'var(--color-primary-600)'  : 'var(--color-text-secondary)',
                boxShadow:        subTab === t.key ? 'var(--shadow-sm)'          : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {agents.length > 0 && (
          <select value={agentFilter} onChange={e => handleAgentChange(e.target.value)}
            className={selectCls} style={{ minWidth: 160 }}>
            <option value="">All agents</option>
            {agents.map(a => (
              <option key={a.user_id} value={a.user_id}>
                {`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || ''}
              </option>
            ))}
          </select>
        )}

        {subTab === 'ratings' && (
          <select value={ratingFilter} onChange={e => handleRatingChange(e.target.value)}
            className={selectCls} style={{ minWidth: 140 }}>
            <option value="">All ratings</option>
            {RATINGS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        )}

        {subTab === 'dispos' && (
          <select value={dispoFilter} onChange={e => handleDispoChange(e.target.value)}
            className={selectCls} style={{ minWidth: 160 }}>
            <option value="">All dispositions</option>
            {DISPOS.map(d => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
        )}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : subTab === 'ratings' ? (
          reviews.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--color-text-secondary)' }}>No call ratings found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['Customer', 'Closer', 'Rating', 'Notes', 'Date'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.map(r => (
                      <tr key={r.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">
                          {r.transfers?.form_data?.FirstName
                            ? `${r.transfers.form_data.FirstName} ${r.transfers.form_data.LastName || ''}`.trim()
                            : r.transfers?.form_data?.customer_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.user_profiles ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                            style={{ backgroundColor: `${RATING_COLOR[r.rating]}20`, color: RATING_COLOR[r.rating] }}>
                            {r.rating?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-secondary max-w-xs">
                          <SmartText text={r.notes || '—'} maxLines={2} />
                        </td>
                        <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(r.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={reviewPage} total={reviewTotal} pageSize={PAGE_SIZE} onChange={setReviewPage} />
            </>
          )
        ) : (
          dispos.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--color-text-secondary)' }}>No dispositions found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['Customer', 'Closer', 'Disposition', 'Notes', 'Date'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dispos.map(d => (
                      <tr key={d.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">
                          {d.transfers?.form_data?.FirstName
                            ? `${d.transfers.form_data.FirstName} ${d.transfers.form_data.LastName || ''}`.trim()
                            : d.transfers?.form_data?.customer_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {d.user_profiles ? `${d.user_profiles.first_name || ''} ${d.user_profiles.last_name || ''}`.trim() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-bold capitalize bg-info-100 text-info-700">
                            {d.disposition?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-secondary max-w-xs">
                          <SmartText text={d.notes || '—'} maxLines={2} />
                        </td>
                        <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(d.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={dispoPage} total={dispoTotal} pageSize={PAGE_SIZE} onChange={setDispoPage} />
            </>
          )
        )}
      </Card>
    </div>
  );
};

export default ReviewsPanel;
