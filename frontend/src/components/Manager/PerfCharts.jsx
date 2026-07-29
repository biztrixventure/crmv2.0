import { useMemo, useState, useEffect } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

// ============================================================================
// PerfCharts — the interactive half of the performance panel.
//
// These bars used to be hand-rolled divs with a `title` attribute. A native
// title tooltip NEVER fires on touch, so on a phone — the device this dashboard
// is mostly read on — the charts carried no readable detail at all. Chart.js
// gives real hit-testing, and everything below is configured for a finger
// first: index-mode tooltips so a tap anywhere in a column reports every
// series, and a PINNED summary row that survives the tap ending (a floating
// tooltip vanishes the moment you lift your finger, which makes it visible but
// not actually readable on mobile).
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

const fmtDay = (d) => {
  const parts = String(d).split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : String(d);
};

// ── Daily activity ──────────────────────────────────────────────────────────
// Two y-axes on purpose. Transfers run 1-2 orders of magnitude above sales, so
// on one shared axis the sales series is a flat line against the floor and
// tells you nothing. Separate axes let both shapes read, and each axis is
// coloured like its series so it is obvious which number belongs to which side.
export function DailyActivityChart({ daily = [] }) {
  const c = useThemeColors();
  const [pinned, setPinned] = useState(null);

  const labels = useMemo(() => daily.map(d => fmtDay(d.date)), [daily]);

  const data = useMemo(() => ({
    labels,
    datasets: [
      { label: 'Transfers', data: daily.map(d => d.transfers), backgroundColor: c.transfers, borderRadius: 3, yAxisID: 'y',  maxBarThickness: 26 },
      { label: 'Sales',     data: daily.map(d => d.sales),     backgroundColor: c.sales,     borderRadius: 3, yAxisID: 'y1', maxBarThickness: 26 },
      { label: 'Approved',  data: daily.map(d => d.approved),  backgroundColor: c.approved,  borderRadius: 3, yAxisID: 'y1', maxBarThickness: 26 },
    ],
  }), [labels, daily, c]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    // intersect:false is what makes this usable with a fingertip — you do not
    // have to land exactly on a 6px bar, anywhere in the column works.
    interaction: { mode: 'index', intersect: false, axis: 'x' },
    onClick: (_evt, els) => {
      if (!els || !els.length) { setPinned(null); return; }
      const d = daily[els[0].index];
      setPinned(d ? { ...d } : null);
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: c.muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 14, font: { size: 11 } },
      },
      tooltip: {
        backgroundColor: c.text, titleColor: c.surface, bodyColor: c.surface,
        padding: 10, cornerRadius: 8, displayColors: true, boxWidth: 8, boxHeight: 8, usePointStyle: true,
        callbacks: {
          title: (items) => {
            const d = daily[items[0].dataIndex];
            return d ? d.date : items[0].label;
          },
          // Conversion answers the question the chart itself raises: "big
          // transfer day — did any of it actually sell?"
          afterBody: (items) => {
            const d = daily[items[0].dataIndex];
            if (!d) return '';
            const conv = d.transfers > 0 ? `${Math.round((d.sales / d.transfers) * 1000) / 10}%` : '—';
            return `\nConversion: ${conv}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.muted, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 12 } },
      y:  { position: 'left',  beginAtZero: true, grid: { color: c.grid },
            ticks: { color: c.transfers, font: { size: 10 }, precision: 0 },
            title: { display: true, text: 'Transfers', color: c.transfers, font: { size: 10, weight: 'bold' } } },
      y1: { position: 'right', beginAtZero: true, grid: { display: false },
            ticks: { color: c.sales, font: { size: 10 }, precision: 0 },
            title: { display: true, text: 'Sales', color: c.sales, font: { size: 10, weight: 'bold' } } },
    },
  }), [c, daily]);

  return (
    <div>
      <div className="h-56 sm:h-72">
        <Bar data={data} options={options} />
      </div>

      {/* Pinned day. A tooltip disappears the instant a finger lifts, so on a
          phone it can be seen but not read. Tapping a column parks the numbers
          here until the next tap. */}
      {pinned ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{pinned.date}</span>
          <span className="text-xs" style={{ color: 'var(--color-info-600)' }}>{pinned.transfers} transfers</span>
          <span className="text-xs" style={{ color: 'var(--color-success-600)' }}>{pinned.sales} sales</span>
          <span className="text-xs" style={{ color: 'var(--color-primary-600)' }}>{pinned.approved} approved</span>
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {pinned.transfers > 0 ? `${Math.round((pinned.sales / pinned.transfers) * 1000) / 10}% conversion` : 'no conversion'}
          </span>
          <button onClick={() => setPinned(null)} className="ml-auto text-xs font-semibold"
            style={{ color: 'var(--color-text-tertiary)' }}>clear</button>
        </div>
      ) : (
        <p className="m-0 mt-2 text-[11px] leading-none" style={{ color: 'var(--color-text-tertiary)' }}>
          Tap or hover a day for its numbers · tap to keep them on screen
        </p>
      )}
    </div>
  );
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
