import { useState, useCallback, useEffect } from 'react';
import { BarChart3, Users, TrendingUp } from 'lucide-react';
import { Card } from '../UI';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import client from '../../api/client';

const ReportsPanel = ({ companyId }) => {
  const [fronters, setFronters] = useState([]);
  const [closers, setClosers]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to }    = dateRange;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 200, date_from, date_to } }),
      ]);

      const allT = tRes.data.transfers || [];
      const allS = sRes.data.sales     || [];

      const fm = {};
      allT.forEach(t => {
        const k    = t.created_by;
        const name = t.user_profiles
          ? `${t.user_profiles.first_name || ''} ${t.user_profiles.last_name || ''}`.trim() || 'Unknown'
          : 'Unknown';
        if (!fm[k]) fm[k] = { id: k, name, total: 0, completed: 0, rejected: 0 };
        fm[k].total++;
        if (t.status === 'completed') fm[k].completed++;
        if (t.status === 'rejected')  fm[k].rejected++;
      });
      setFronters(Object.values(fm).sort((a, b) => b.completed - a.completed));

      const cm = {};
      allS.forEach(s => {
        const k = s.closer_id;
        if (!k) return;
        if (!cm[k]) cm[k] = { id: k, name: k.slice(0, 8), total: 0, won: 0 };
        cm[k].total++;
        if (['sold', 'closed_won'].includes(s.status)) cm[k].won++;
      });
      setClosers(Object.values(cm).sort((a, b) => b.won - a.won));
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId, date_from, date_to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-text flex items-center gap-2">
          <BarChart3 size={22} style={{ color: 'var(--color-primary-600)' }} />
          Reports &amp; Leaderboards
        </h2>
        <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4 flex items-center gap-2">
              <Users size={20} /> Fronter Leaderboard
            </h3>
            {fronters.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No data yet.</p>
            ) : (
              <div className="space-y-3">
                {fronters.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl border"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: i < 3 ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                        color:      i < 3 ? 'white' : 'var(--color-text-secondary)',
                      }}>
                      {i + 1}
                    </span>
                    <span className="flex-1 font-semibold text-text text-sm">{f.name}</span>
                    <span className="text-xs text-text-secondary">{f.total} leads</span>
                    <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4 flex items-center gap-2">
              <TrendingUp size={20} /> Closer Leaderboard
            </h3>
            {closers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No data yet.</p>
            ) : (
              <div className="space-y-3">
                {closers.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: i < 3 ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                        color:      i < 3 ? 'white' : 'var(--color-text-secondary)',
                      }}>
                      {i + 1}
                    </span>
                    <span className="flex-1 font-semibold text-text text-sm">{c.name}</span>
                    <span className="text-xs text-text-secondary">{c.total} sales</span>
                    <span className="text-xs font-bold text-success-600">{c.won} won</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default ReportsPanel;
