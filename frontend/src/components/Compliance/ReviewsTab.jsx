import { useState, useCallback, useEffect } from 'react';
import { Star } from 'lucide-react';
import client from '../../api/client';
import ExportModal from './ExportModal';
import { fmtDate, customerName, downloadCSV, TabHeader, Spinner, Empty, Th, fetchAllForExport } from './shared';

const RATING_COLOR = {
  excellent: '#16a34a', good: '#2563eb', average: '#d97706',
  below_average: '#ea580c', bad: '#dc2626',
};

const ReviewsTab = ({ companyList }) => {
  const [reviews, setReviews]   = useState([]);
  const [dispos, setDispos]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [subTab, setSubTab]     = useState('ratings');
  const [company, setCompany]   = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        client.get('reviews',              { params: { company_id: company || undefined, limit: 200 } }),
        client.get('reviews/dispositions', { params: { company_id: company || undefined, limit: 200 } }),
      ]);
      setReviews(rRes.data.reviews || []);
      setDispos(dRes.data.dispositions || []);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [company]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async ({ company: co }) => {
    const allReviews = await fetchAllForExport('reviews', { company_id: co || undefined }, 'reviews');
    const rows = allReviews.map(r => [
      customerName(r.transfers) || '',
      companyList.find(c => c.id === r.company_id)?.name || '',
      r.user_profiles ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim() : '',
      r.rating || '', r.notes || '', fmtDate(r.created_at),
    ]);
    downloadCSV(rows, ['Customer','Company','Closer','Rating','Notes','Date'],
      `reviews_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const companyName = (id) => companyList.find(c => c.id === id)?.name || '—';
  const profileName = (p) => p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || '—' : '—';

  const data = subTab === 'ratings' ? reviews : dispos;

  return (
    <div>
      <TabHeader
        title="Call Reviews"
        subtitle="Ratings and dispositions across all companies"
        onRefresh={load}
        onExport={() => setExportOpen(true)}
        extra={
          <div className="flex items-center gap-2">
            <select value={company} onChange={e => setCompany(e.target.value)}
              className="input text-sm py-1.5" style={{ minWidth: 160 }}>
              <option value="">All companies</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-1 p-1 rounded-xl"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {[{ key: 'ratings', label: 'Ratings' }, { key: 'dispos', label: 'Dispositions' }].map(t => (
                <button key={t.key} onClick={() => setSubTab(t.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: subTab === t.key ? 'var(--color-surface)' : 'transparent',
                    color: subTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                    boxShadow: subTab === t.key ? 'var(--shadow-sm)' : 'none',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : data.length === 0 ? (
          <Empty icon={Star} msg={`No ${subTab === 'ratings' ? 'ratings' : 'dispositions'} found.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th>Customer</Th>
                  <Th>Company</Th>
                  <Th>Closer</Th>
                  <Th>{subTab === 'ratings' ? 'Rating' : 'Disposition'}</Th>
                  <Th>Notes</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>
                      {customerName(r.transfers)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {companyName(r.company_id)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {profileName(r.user_profiles)}
                    </td>
                    <td className="px-4 py-3">
                      {subTab === 'ratings' ? (
                        <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                          style={{
                            backgroundColor: `${RATING_COLOR[r.rating] || '#6b7280'}22`,
                            color: RATING_COLOR[r.rating] || '#6b7280',
                          }}>
                          {r.rating?.replace(/_/g,' ')}
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                          style={{ backgroundColor: 'var(--color-info-100)', color: 'var(--color-info-700)' }}>
                          {r.disposition?.replace(/_/g,' ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate"
                      style={{ color: 'var(--color-text-secondary)' }}>
                      {r.notes || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmtDate(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {exportOpen && (
        <ExportModal tab="reviews" companyList={companyList}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}
    </div>
  );
};

export default ReviewsTab;
