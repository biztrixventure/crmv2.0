// ============================================================================
// companyReportMetrics.js -- the ONE catalog of Company Reports columns.
//
// Everything on the report that shows a per-agent number reads this list: the
// leaderboard columns, the column chooser, the Compare grid, the CSV export and
// superadmin Settings -> "hidden metrics". So a new metric is ONE entry here
// (plus the field in app_company_agent_report / utils/companyReport.js if it is
// genuinely new data) -- nothing else to wire.
//
// Entry:
//   key       stable id -- stored in viewers' column choices and in
//             business_config reports.company.hidden_metrics. Never rename.
//   label     header text; a function of side when the meaning flips
//             (a fronter SENDS transfers, a closer RECEIVES them)
//   sides     which company types it applies to
//   fmt       int | pct | money | num | text
//   money     needs view_financial_data (the server strips it otherwise)
//   qa        hidden when the viewer is not shown QA
//   better    'high' | 'low' -- which way is good (Compare highlights the best)
//   get       value accessor (default: row[key])
//   csv       CSV cell (default: get)
//   tip       plain-English meaning, shown on hover
//   def       on by default for these sides
// ============================================================================

const both = ['fronter', 'closer'];
const partnerWord = (side) => (side === 'closer' ? 'fronter' : 'closer');

export const METRIC_GROUPS = [
  { id: 'volume',    label: 'Volume' },
  { id: 'sales',     label: 'Sales' },
  { id: 'money',     label: 'Money' },
  { id: 'leads',     label: 'Leads & outcomes' },
  { id: 'callbacks', label: 'Callbacks' },
  { id: 'quality',   label: 'Quality' },
];

export const METRICS = [
  // ── volume ──
  { key: 'transfers', group: 'volume', sides: both, fmt: 'int', better: 'high', def: both,
    label: (s) => (s === 'closer' ? 'Transfers received' : 'Transfers'),
    tip: 'Transfers in the date range (US Eastern days). Dialer ghosts and untouched dialer-pending rows are not transfers.' },
  { key: 'daily_avg', group: 'volume', sides: both, fmt: 'num', better: 'high', def: ['fronter'],
    label: 'Per day', tip: 'Transfers divided by every day in the range.' },
  { key: 'per_active_day', group: 'volume', sides: both, fmt: 'num', better: 'high',
    label: 'Per working day', tip: 'Transfers divided by the days this agent actually had a transfer.' },
  { key: 'days_active', group: 'volume', sides: both, fmt: 'int', better: 'high',
    label: 'Days worked', tip: 'Days in the range with at least one transfer.' },

  // ── sales ──
  { key: 'xfer_sold', group: 'sales', sides: both, fmt: 'int', better: 'high', def: both,
    label: 'Converted', tip: 'Transfers from this range that have a sale (on any date). Post-dates are not sales.' },
  { key: 'conversion', group: 'sales', sides: both, fmt: 'pct', better: 'high', def: both,
    label: 'Conversion', tip: 'Converted ÷ transfers. Blank when there were no transfers -- not 0%.' },
  { key: 'sold', group: 'sales', sides: both, fmt: 'int', better: 'high', def: both,
    label: 'Sold', tip: 'Sales dated in the range, whatever happened to them later. Post-dates excluded.' },
  { key: 'active', group: 'sales', sides: both, fmt: 'int', better: 'high', def: both,
    label: 'Still active', tip: 'Of the sales in the range, how many are still closed-won today.' },
  { key: 'stick_rate', group: 'sales', sides: both, fmt: 'pct', better: 'high', def: both,
    label: 'Stick rate', tip: 'Still active ÷ sold. Recent sales have had less time to cancel, so compare like periods.' },
  { key: 'cancelled', group: 'sales', sides: both, fmt: 'int', better: 'low', def: ['closer'],
    label: 'Cancelled', tip: 'Sales from the range that were later cancelled.' },
  { key: 'cancel_rate', group: 'sales', sides: both, fmt: 'pct', better: 'low',
    label: 'Cancel rate', tip: 'Cancelled ÷ sold.' },
  { key: 'median_days_to_cancel', group: 'sales', sides: both, fmt: 'num', better: 'high',
    label: 'Days to cancel', tip: 'Median days from sale to cancellation, over the cancelled ones.' },
  { key: 'in_review', group: 'sales', sides: both, fmt: 'int',
    label: 'In review', tip: 'Sales still open or waiting on compliance.' },
  { key: 'post_dates', group: 'sales', sides: both, fmt: 'int', def: ['closer'],
    label: 'Post-dates', tip: 'Post-dated reminders. NOT sales -- the card has not been charged -- and never counted in sold or money.' },
  { key: 'resells', group: 'sales', sides: both, fmt: 'int',
    label: 'Resells', tip: 'Sales flagged as a resell to an existing customer.' },
  { key: 'recredited', group: 'sales', sides: ['fronter'], fmt: 'int',
    label: 'Re-credited', tip: 'Sales credited to this agent on a transfer somebody else created (e.g. punched to a placeholder before the agent had a login). Counted in sold, not in conversion.' },
  { key: 'sales_per_day', group: 'sales', sides: both, fmt: 'num', better: 'high',
    label: 'Sales / day', tip: 'Sold divided by every day in the range.' },
  { key: 'median_days_to_sale', group: 'sales', sides: both, fmt: 'num', better: 'low',
    label: 'Days to sale', tip: 'Median days from the transfer to its sale.' },

  // ── money ──
  { key: 'dp_sold', group: 'money', sides: both, fmt: 'money', money: true, better: 'high', def: both,
    label: 'Down payments', tip: 'Upfront down payments on the sales in the range (post-dates excluded).' },
  { key: 'dp_active', group: 'money', sides: both, fmt: 'money', money: true, better: 'high',
    label: 'DP (still active)', tip: 'Down payments on the sales that are still active.' },
  { key: 'monthly_active', group: 'money', sides: both, fmt: 'money', money: true, better: 'high', def: ['closer'],
    label: 'Monthly book', tip: 'Monthly payments on the sales that are still active -- the recurring money still on the books.' },
  { key: 'est_collected', group: 'money', sides: both, fmt: 'money', money: true, better: 'high',
    label: 'Est. collected', tip: 'ESTIMATE: down payment + one monthly payment per whole month each policy stayed live. There is no payment ledger.' },
  { key: 'avg_deal', group: 'money', sides: both, fmt: 'money', money: true, better: 'high', def: ['closer'],
    label: 'Avg deal', tip: 'Down payments ÷ sold.' },

  // ── leads & outcomes ──
  { key: 'top_disposition', group: 'leads', sides: both, fmt: 'text', def: both,
    label: 'Usual outcome',
    get: (a) => a.top_disposition?.label || null,
    csv: (a) => (a.top_disposition ? `${a.top_disposition.label} (${a.top_disposition.pct}%)` : ''),
    tip: 'The closer disposition this agent\'s transfers most often ended on.' },
  { key: 'best_partner', group: 'leads', sides: both, fmt: 'text', def: both,
    label: (s) => `Best ${partnerWord(s)}`,
    get: (a) => a.best?.by_sold?.name || null,
    csv: (a) => (a.best?.by_sold ? `${a.best.by_sold.name} (${a.best.by_sold.sold} sold)` : ''),
    tip: 'The partner who turned the most of this agent\'s transfers into sales. Placeholder accounts are never picked.' },
  { key: 'no_partner', group: 'leads', sides: ['fronter'], fmt: 'int', better: 'low',
    label: 'Never assigned', tip: 'Transfers that were never given to a closer.' },
  { key: 'no_outcome', group: 'leads', sides: both, fmt: 'int', better: 'low',
    label: 'No outcome', tip: 'Transfers with no closer disposition yet.' },

  // ── callbacks ──
  { key: 'cb_total', group: 'callbacks', sides: both, fmt: 'int', def: ['fronter'],
    label: 'Callbacks', tip: 'Callbacks scheduled inside the range.' },
  { key: 'cb_completed', group: 'callbacks', sides: both, fmt: 'int', better: 'high',
    label: 'Callbacks done', tip: 'Callbacks marked completed.' },
  { key: 'cb_completion', group: 'callbacks', sides: both, fmt: 'pct', better: 'high', def: ['fronter'],
    label: 'Callback rate', tip: 'Completed ÷ scheduled.' },
  { key: 'cb_missed', group: 'callbacks', sides: both, fmt: 'int', better: 'low', def: ['fronter'],
    label: 'Missed', tip: 'Callbacks still pending after their time passed.' },
  { key: 'cb_no_contact', group: 'callbacks', sides: both, fmt: 'int',
    label: 'No contact', tip: 'Callbacks that ended on no answer or a voicemail.' },

  // ── quality ──
  { key: 'qa_avg', group: 'quality', sides: both, fmt: 'pct', qa: true, better: 'high', def: both,
    label: 'QA score', tip: 'Mean QA2 score over submitted reviews in the range. Blank = never reviewed, not zero.' },
  { key: 'qa_n', group: 'quality', sides: both, fmt: 'int', qa: true,
    label: 'QA reviews', tip: 'Submitted QA2 reviews in the range.' },
  { key: 'qa_pass_rate', group: 'quality', sides: both, fmt: 'pct', qa: true, better: 'high',
    label: 'QA pass rate', tip: 'Reviews that passed ÷ reviews.' },
];

export const metricLabel = (m, side) => (typeof m.label === 'function' ? m.label(side) : m.label);
export const metricValue = (m, row) => (m.get ? m.get(row) : row?.[m.key]);
export const metricCsv = (m, row) => (m.csv ? m.csv(row) : (metricValue(m, row) ?? ''));

// Which metrics this viewer may see at all.
export function availableMetrics({ side, canSeeMoney, canSeeQa, hidden = [] }) {
  const off = new Set(hidden);
  return METRICS.filter(m => m.sides.includes(side)
    && !off.has(m.key)
    && (!m.money || canSeeMoney)
    && (!m.qa || canSeeQa));
}

export const defaultColumns = (side) => METRICS.filter(m => (m.def || []).includes(side)).map(m => m.key);

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Blank, never 0, for a value that does not exist.
export function formatMetric(fmt, v) {
  if (v == null || v === '' || Number.isNaN(v)) return '—';
  switch (fmt) {
    case 'int':   return nf0.format(v);
    case 'num':   return nf1.format(v);
    case 'pct':   return `${nf1.format(v)}%`;
    case 'money': return money0.format(v);
    default:      return String(v);
  }
}

// What agents are ranked by (mirrors EARNER_METRICS in backend
// utils/companyReport.js, same order). SALES COUNT is first and the default:
// the number of sales is what an agent is judged on in this CRM. Money metrics
// come after it and are never the default.
export const EARNER_METRICS = [
  { key: 'sold',           label: 'Sales (count)',               short: 'sales' },
  { key: 'active',         label: 'Sales still active (count)',  short: 'active sales' },
  { key: 'dp_sold',        label: 'Down payments (all sales)',   short: 'down payments', money: true },
  { key: 'dp_active',      label: 'Down payments (still active)', short: 'active down payments', money: true },
  { key: 'est_collected',  label: 'Estimated collected',         short: 'est. collected', money: true },
  { key: 'monthly_active', label: 'Monthly book',                short: 'monthly book', money: true },
];

export const earnerLabel = (key) => (EARNER_METRICS.find(m => m.key === key)?.short || key);
export const isMoneyMetric = (key) => !!EARNER_METRICS.find(m => m.key === key)?.money;
// How to print a ranking value: a count, or an amount.
export const earnerFmt = (key) => (isMoneyMetric(key) ? 'money' : 'int');
