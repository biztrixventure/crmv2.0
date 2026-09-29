import { useState } from 'react';
import { formatMetric } from '../../config/companyReportMetrics';

// ============================================================================
// DailyBars -- one series, one bar per day, one axis.
//
// Deliberately a single measure per chart: transfers and sales live on very
// different scales, so they get two charts rather than a dual axis. Bars are
// HTML, not canvas, so they follow the theme tokens in light and dark with no
// per-theme code, and stay crisp at any width. Every day in the range is a
// slot (zeros included) so a quiet day reads as quiet, not as missing.
// ============================================================================
const fmtDay = (d) => {
  const [y, m, day] = String(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export default function DailyBars({ title, data = [], valueKey, fmt = 'int', color = 'var(--color-primary-600)', height = 120 }) {
  const [hover, setHover] = useState(null);
  const values = data.map(d => Number(d[valueKey] || 0));
  const peak = Math.max(0, ...values);
  const scale = Math.max(1, peak);
  const sum = values.reduce((t, v) => t + v, 0);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-xs font-semibold m-0" style={{ color: 'var(--color-text-secondary)' }}>{title}</p>
        <p className="text-xs m-0 tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          {h ? <>{fmtDay(h.d)} · <b style={{ color: 'var(--color-text)' }}>{formatMetric(fmt, h[valueKey] || 0)}</b></>
             : <>Total <b style={{ color: 'var(--color-text)' }}>{formatMetric(fmt, sum)}</b> · peak {formatMetric(fmt, peak)}</>}
        </p>
      </div>
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {/* recessive gridline at the peak */}
        <div aria-hidden className="absolute left-0 right-0 top-0" style={{ borderTop: '1px dashed var(--color-border)' }} />
        <div className="absolute inset-0 flex items-end" style={{ gap: data.length > 60 ? 1 : 2 }}
          role="img" aria-label={`${title}: ${formatMetric(fmt, sum)} over ${data.length} days`}>
          {data.map((d, i) => {
            const v = values[i];
            const pct = v > 0 ? Math.max(3, (v / scale) * 100) : 0;
            return (
              // Hit target is the whole column, not just the bar.
              <div key={d.d} className="flex-1 h-full flex items-end min-w-0"
                onMouseEnter={() => setHover(i)}>
                <div className="w-full transition-opacity"
                  style={{
                    height: `${pct}%`,
                    background: color,
                    borderRadius: '4px 4px 0 0',
                    opacity: hover == null || hover === i ? 1 : 0.45,
                  }} />
              </div>
            );
          })}
        </div>
        <div aria-hidden className="absolute left-0 right-0 bottom-0" style={{ borderTop: '1px solid var(--color-border)' }} />
      </div>
      {data.length > 0 && (
        <div className="flex justify-between mt-1 text-[10px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>{fmtDay(data[0].d)}</span>
          <span>{fmtDay(data[data.length - 1].d)}</span>
        </div>
      )}
    </div>
  );
}
