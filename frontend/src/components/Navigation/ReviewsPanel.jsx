import { useState, useCallback, useEffect } from 'react';
import { Star } from 'lucide-react';
import { Card, SmartText } from '../UI';
import client from '../../api/client';

const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

const ReviewsPanel = ({ companyId }) => {
  const [reviews, setReviews]     = useState([]);
  const [dispos, setDispos]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [subTab, setSubTab]       = useState('ratings');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        client.get('reviews',              { params: { company_id: companyId, limit: 100 } }),
        client.get('reviews/dispositions', { params: { company_id: companyId, limit: 100 } }),
      ]);
      setReviews(rRes.data.reviews || []);
      setDispos(dRes.data.dispositions || []);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4 animate-fade-in">
      <h2 className="text-2xl font-bold text-text flex items-center gap-2">
        <Star size={22} style={{ color: 'var(--color-primary-600)' }} />
        Call Reviews
      </h2>

      <div className="flex gap-1 p-1 rounded-xl w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {[{ key: 'ratings', label: 'Call Ratings' }, { key: 'dispos', label: 'Dispositions' }].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: subTab === t.key ? 'var(--color-surface)' : 'transparent',
              color:            subTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
              boxShadow:        subTab === t.key ? 'var(--shadow-sm)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : subTab === 'ratings' ? (
          reviews.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">No call ratings yet.</div>
          ) : (
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
          )
        ) : (
          dispos.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">No dispositions yet.</div>
          ) : (
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
          )
        )}
      </Card>
    </div>
  );
};

export default ReviewsPanel;
