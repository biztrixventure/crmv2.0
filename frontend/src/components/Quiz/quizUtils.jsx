import { Tag, Trophy, Medal } from 'lucide-react';

export const pct = (n) => (n == null ? '—' : `${n}%`);

export const fmtDue = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

// Deterministic color per category name, so the same tag always reads the
// same color across the builder, the list, the leaderboard, and MyQuizzes.
const CATEGORY_PALETTE = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#2563eb', '#db2777', '#65a30d'];
export const categoryColor = (cat) => {
  if (!cat) return null;
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
};

export const CategoryBadge = ({ category }) => {
  if (!category) return null;
  const c = categoryColor(category);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
      <Tag size={9} /> {category}
    </span>
  );
};

// A rank badge: gold/silver/bronze medal for the top 3, a plain number after.
export const RankBadge = ({ rank }) => {
  if (rank === 1) return <Trophy size={16} style={{ color: '#f59e0b' }} />;
  if (rank === 2) return <Medal size={16} style={{ color: '#9ca3af' }} />;
  if (rank === 3) return <Medal size={16} style={{ color: '#b45309' }} />;
  return <span className="text-xs font-bold w-4 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{rank}</span>;
};

// Slim inline progress bar — used for avg-score and completion visuals.
export const MiniBar = ({ value, tone = 'var(--color-primary-600)', track = 'var(--color-bg-secondary)' }) => (
  <div className="h-1.5 rounded-full overflow-hidden flex-1" style={{ background: track }}>
    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, background: tone }} />
  </div>
);

// Pass/fail pill — a submitted attempt scored above/below the quiz's threshold.
export const PassFailBadge = ({ pass }) => {
  if (pass == null) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
      style={{ background: pass ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: pass ? 'var(--color-success-600)' : 'var(--color-error-500)' }}>
      {pass ? 'PASS' : 'FAIL'}
    </span>
  );
};
