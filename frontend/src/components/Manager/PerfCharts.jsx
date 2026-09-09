import { useMemo, useState, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

// Only the doughnut is left, so only its pieces are registered. Chart.js v4 is
// modular -- registering the bar/line controllers and the cartesian scales was
// what pulled them into this chunk, and nothing draws them any more.
ChartJS.register(ArcElement, Tooltip, Legend);

// ============================================================================
// PerfCharts — the charted part of the performance panel.
//
// One chart left. DailyActivityChart lived here too: a dual-axis bar chart of
// transfers vs sales per day, with a pinned summary row because a floating
// Chart.js tooltip vanishes the moment a finger lifts. It went with the Daily
// Activity panel — the KPI tiles and the funnel already state that shape as
// numbers, and it cost a per-day series for the company AND for a focused agent
// on every date change. Its chart.js registrations went with it (see above);
// /stats/team-trends still serves a daily series if something needs to draw one.
//
// What remains is configured for touch first, since this dashboard is mostly
// read on a phone: real hit-testing rather than a `title` attribute, which
// never fires on touch at all.
// ============================================================================

// Chart.js paints to a canvas, so it cannot use CSS variables — they have to be
// resolved to real colours at render time and re-resolved when the theme flips,
// or every chart stays light-mode coloured on a dark page.
function useThemeColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n, fallback) => (s.getPropertyValue(n) || '').trim() || fallback;
    return {
      transfers: v('--color-info-600', '#2563eb'),
      sales:     v('--color-success-600', '#16a34a'),
      approved:  v('--color-primary-600', '#0d9488'),
      pending:   v('--color-warning-600', '#d97706'),
      cancelled: v('--color-error-600', '#dc2626'),
      text:      v('--color-text', '#111827'),
      muted:     v('--color-text-tertiary', '#6b7280'),
      grid:      v('--color-border', '#e5e7eb'),
      surface:   v('--color-surface', '#ffffff'),
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    // The theme toggle stamps data-theme / class on <html>; re-read on both.
    const ob = new MutationObserver(() => setC(read()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => ob.disconnect();
  }, []);
  return c;
}

// ── Outcome mix ─────────────────────────────────────────────────────────────
// Where the sales ENDED UP, which the funnel deliberately does not show: the
// funnel stops at approved, so cancellations and the compliance queue are
// invisible there. Small, but it is the difference between "we sold 52" and
// "we sold 52 and kept 46".
export function OutcomeChart({ approved = 0, pending = 0, cancelled = 0 }) {
  const c = useThemeColors();
  const total = approved + pending + cancelled;

  const data = useMemo(() => ({
    labels: ['Approved', 'In review', 'Cancelled'],
    datasets: [{
      data: [approved, pending, cancelled],
      backgroundColor: [c.sales, c.pending, c.cancelled],
      borderColor: c.surface,
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }), [approved, pending, cancelled, c]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: c.muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } },
      },
      tooltip: {
        backgroundColor: c.text, titleColor: c.surface, bodyColor: c.surface,
        padding: 10, cornerRadius: 8, usePointStyle: true, boxWidth: 8, boxHeight: 8,
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed || 0;
            const share = total > 0 ? ` (${Math.round((v / total) * 1000) / 10}%)` : '';
            return ` ${ctx.label}: ${v}${share}`;
          },
        },
      },
    },
  }), [c, total]);

  if (!total) {
    return (
      <p className="m-0 text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
        No sales in this range yet.
      </p>
    );
  }

  return (
    <div className="h-56 sm:h-64 relative">
      <Doughnut data={data} options={options} />
    </div>
  );
}
