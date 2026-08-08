import { useState, useCallback, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import client from '../../api/client';
import { TableScroll } from '../UI/kit';
import ExportModal from './ExportModal';
import { FilterSelect } from '../UI/FilterBar';
import { fmtDate, customerName, TabHeader, Spinner, Empty, ActiveFilters, Th, TqTh, fetchAllForExport } from './shared';
import { writeExport } from '../../utils/exportSpec';
import { buildFilename } from '../../utils/downloadFilename';
import { useExportColumns } from '../../hooks/useExportColumns';
import { useTableQuery } from '../../hooks/useTableQuery';
import { clientColumns } from '../../utils/clientColumns';

const RATING_COLOR = {
  excellent: '#16a34a', good: '#2563eb', average: '#d97706',
  below_average: '#ea580c', bad: '#dc2626',
};

// Client mode: both lists are fetched whole (limit 200) and held in state, so
// filtering in memory is a keystroke rather than a request. This tab had NO
// sorting at all before — every column below is new.
//
// The Rating / Disposition column is deliberately NOT in the catalog. It is the
// one header whose meaning changes with the sub-tab, and useTableQuery reads its
// stored scope once at mount — so a `rating` filter would survive a switch to
// Dispositions and silently match nothing. The sub-tab toggle already IS that
// filter; a header that lies about the current dataset is worse than no header.
const COLUMNS = clientColumns({
  customer: 'text',
  company:  'text',
  closer:   'text',
  notes:    'text',
  date:     'date',
});

const ReviewsTab = ({ companyList }) => {
  // null = unconfigured → this tab keeps its own default column set.
  const { allowedFor } = useExportColumns(['reviews']);
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
    writeExport({
      dataset: 'reviews', surface: 'compliance_reviews', allowed: allowedFor('reviews'),
      rows: allReviews,
      // Company is resolved client-side from the loaded list, so the Company
      // column needs the lookup handed to it.
      ctx: { companyName: (id) => companyList.find(c => c.id === id)?.name || '' },
      filename: buildFilename({ dataset: 'reviews', scope: companyList.find(c => c.id === co)?.name }),
    });
  };

  const companyName = (id) => companyList.find(c => c.id === id)?.name || '—';
  const profileName = (p) => p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || '—' : '—';

  // Sort and filter on what the row DISPLAYS, not on what it stores: the
  // Company cell shows a resolved name, so "company contains vert" has to see
  // "1-Vertex", not a uuid. Same for Customer (built from the joined transfer)
  // and Closer (built from the joined profile).
  const accessor = useCallback((row, key) => {
    if (key === 'customer') return customerName(row?.transfers);
    if (key === 'company')  return companyList.find(c => c.id === row?.company_id)?.name || '';
    if (key === 'closer')   return row?.user_profiles
      ? `${row.user_profiles.first_name || ''} ${row.user_profiles.last_name || ''}`.trim()
      : '';
    if (key === 'notes')    return row?.notes;
    if (key === 'date')     return row?.created_at;
    return row?.[key];
  }, [companyList]);

  const tq = useTableQuery({
    scope: 'compliance:reviews',
    mode: 'client',
    columns: COLUMNS,
    defaultSort: { by: 'date', dir: 'desc' },   // newest first — what the endpoint already returned
    accessor,
  });

  const source = subTab === 'ratings' ? reviews : dispos;
  const data = useMemo(() => tq.apply(source), [tq, source]);

  return (
    <div>
      <TabHeader
        title="Call Reviews"
        subtitle="Ratings and dispositions across all companies"
        onRefresh={load}
        exportArea="reviews"
        onExport={() => setExportOpen(true)}
        extra={
          <div className="flex items-center gap-2">
            <FilterSelect value={company} onChange={e => setCompany(e.target.value)} title="Filter by company">
              <option value="">All companies</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FilterSelect>
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

      <ActiveFilters tq={tq} />

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {/* Gate the empty state on the SOURCE, not the filtered result. Gating
            on `data` would swap the whole table — headers included — for "No
            ratings found" the moment a column filter matched nothing, leaving
            no control on screen to clear the filter that caused it. */}
        {loading ? <Spinner /> : source.length === 0 ? (
          <Empty icon={Star} msg={`No ${subTab === 'ratings' ? 'ratings' : 'dispositions'} found.`} />
        ) : (
          <TableScroll stickyFirst label="Call reviews">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <TqTh tq={tq} col="customer">Customer</TqTh>
                  <TqTh tq={tq} col="company">Company</TqTh>
                  <TqTh tq={tq} col="closer">Closer</TqTh>
                  {/* Not in the catalog on purpose — see COLUMNS above. */}
                  <Th>{subTab === 'ratings' ? 'Rating' : 'Disposition'}</Th>
                  <TqTh tq={tq} col="notes">Notes</TqTh>
                  <TqTh tq={tq} col="date">Date</TqTh>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      No rows match the column filters.{' '}
                      <button onClick={tq.clearAll} className="font-semibold underline" style={{ color: 'var(--color-primary-600)' }}>
                        Clear filters
                      </button>
                    </td>
                  </tr>
                )}
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
          </TableScroll>
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
