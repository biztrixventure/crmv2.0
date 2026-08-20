// ── SuperAdmin Payout report PDF ─────────────────────────────────────────────
// A4, vector-drawn with jsPDF (same technique as qaReportPdf.js) — header band,
// KPI cards (All approved / Pending / Paid / Reverted, each $ + count), a
// pending→paid→reverted donut, then a paginated table of every exported row.
// No rasterized charts, no embedded fonts, so the file stays a few KB.
import { jsPDF } from 'jspdf';
import { buildFilename } from './downloadFilename';
import { getBrandName } from './branding';
import { fmtSaleDate } from './timezone';

const INK = '#0f172a', SLATE = '#334155', MUTE = '#64748b', FAINT = '#94a3b8';
const LINE = '#e2e8f0', ZEBRA = '#fbfdff';
const BLUE = '#2563eb', GREEN = '#16a34a', RED = '#dc2626', AMBER = '#d97706';
const hx = (h) => { const n = h.replace('#', ''); return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]; };
const money = (v) => `$${Math.round(Number(v) || 0).toLocaleString()}`;

const PAYOUT_LABEL = { pending: 'Pending', paid: 'Paid', reverted: 'Reverted' };
const PAYOUT_TINT = { pending: AMBER, paid: GREEN, reverted: RED };
const PAYOUT_CONFIRMED_LABEL = { pending: 'Pending', yes: 'Yes', no: 'No' };
const PAYOUT_CONFIRMED_TINT = { pending: AMBER, yes: GREEN, no: MUTE };
const CANCEL_LIKE = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute']);

export function exportPayoutReportPdf({ rows = [], kpis = null, filters = {}, companyName = '', labelOf } = {}) {
  // LANDSCAPE: the report carries company / fronter / closer / both paid-to
  // flags now — 14 columns need more than the 182mm A4 portrait gives. Every
  // other element (header band, KPI cards, donut, footer) is derived from W/H,
  // so the flip is just these two numbers.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, H = 210, M = 14;
  let y = 0;

  const fill = (h) => { const [r, g, b] = hx(h); doc.setFillColor(r, g, b); };
  const ink = (h) => { const [r, g, b] = hx(h); doc.setTextColor(r, g, b); };
  const stroke = (h) => { const [r, g, b] = hx(h); doc.setDrawColor(r, g, b); };
  const font = (style = 'normal', size = 9) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const clip = (str, w, size, style = 'normal') => {
    font(style, size); let t = String(str ?? '');
    if (doc.getTextWidth(t) <= w) return t;
    while (t.length > 1 && doc.getTextWidth(t + '…') > w) t = t.slice(0, -1);
    return t + '…';
  };
  const donut = (cx, cy, rO, rI, segs) => {
    const total = segs.reduce((a, d) => a + (d.value || 0), 0) || 1;
    let ang = -Math.PI / 2;
    for (const d of segs) {
      const sweep = ((d.value || 0) / total) * Math.PI * 2;
      if (sweep <= 0) continue;
      const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 90)));
      fill(d.color);
      for (let i = 0; i < steps; i++) {
        const t0 = ang + sweep * i / steps, t1 = ang + sweep * (i + 1) / steps;
        doc.triangle(cx, cy, cx + Math.cos(t0) * rO, cy + Math.sin(t0) * rO, cx + Math.cos(t1) * rO, cy + Math.sin(t1) * rO, 'F');
      }
      ang += sweep;
    }
    fill('#ffffff'); doc.circle(cx, cy, rI, 'F');
  };
  const newPageTop = () => { doc.addPage(); y = 20; };
  const ensure = (need) => { if (y + need > H - 16) newPageTop(); };

  // ── header band ────────────────────────────────────────────────────────────
  fill(INK); doc.rect(0, 0, W, 30, 'F');
  fill(BLUE); doc.rect(0, 30, W, 1.4, 'F');
  font('bold', 17); ink('#ffffff');
  doc.text('Payout Report', M, 13);
  font('normal', 9); ink('#cbd5e1');
  const sub = [companyName || 'All companies', filters.payout_status ? `DP Status: ${PAYOUT_LABEL[filters.payout_status] || filters.payout_status}` : 'Every DP Status'].filter(Boolean).join('    ·    ');
  doc.text(sub, M, 20);
  if (filters.date_from || filters.date_to) doc.text(`${filters.date_from || '…'}  →  ${filters.date_to || '…'}`, M, 25.5);
  font('normal', 8); ink('#94a3b8');
  doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, W - M, 25.5, { align: 'right' });
  y = 40;

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const g = (key) => kpis?.[key]?.gross || 0;
  const c = (key) => kpis?.[key]?.count || 0;
  const totalGross = g('pending') + g('paid') + g('reverted');
  const totalCount = c('pending') + c('paid') + c('reverted');
  const cards = [
    { label: 'ALL APPROVED', value: money(totalGross), sub: `${totalCount.toLocaleString()} sale${totalCount === 1 ? '' : 's'}`, tint: BLUE },
    { label: 'PENDING', value: money(g('pending')), sub: `${c('pending').toLocaleString()} sale${c('pending') === 1 ? '' : 's'}`, tint: AMBER },
    { label: 'PAID', value: money(g('paid')), sub: `${c('paid').toLocaleString()} sale${c('paid') === 1 ? '' : 's'}`, tint: GREEN },
    { label: 'REVERTED', value: money(g('reverted')), sub: `${c('reverted').toLocaleString()} sale${c('reverted') === 1 ? '' : 's'}`, tint: RED },
  ];
  const gap = 3.5, kw = (W - 2 * M - gap * (cards.length - 1)) / cards.length, kh = 26;
  cards.forEach((k, i) => {
    const x = M + i * (kw + gap);
    fill('#ffffff'); stroke(LINE); doc.setLineWidth(0.3);
    doc.roundedRect(x, y, kw, kh, 2, 2, 'FD');
    fill(k.tint); doc.roundedRect(x, y, kw, 2.4, 2, 2, 'F'); doc.rect(x, y + 1.4, kw, 1, 'F');
    font('bold', 6.5); ink(MUTE); doc.text(k.label, x + 3.5, y + 8.5);
    font('bold', 15); ink(k.tint); doc.text(k.value, x + 3.5, y + 16.5);
    font('normal', 6.5); ink(FAINT); doc.text(k.sub, x + 3.5, y + 22);
  });
  y += kh + 9;

  const heading = (t, tint = BLUE) => {
    ensure(12);
    fill(tint); doc.circle(M + 1.4, y - 1.2, 1.4, 'F');
    font('bold', 10.5); ink(INK); doc.text(t, M + 5, y);
    const tw = doc.getTextWidth(t);
    stroke(LINE); doc.setLineWidth(0.3); doc.line(M + 8 + tw, y - 1, W - M, y - 1);
    y += 6;
  };

  // ── payout split donut ────────────────────────────────────────────────────
  if (kpis && totalGross > 0) {
    heading('Payout split (by down payment)');
    const cardH = 40, cardW = W - 2 * M;
    fill('#ffffff'); stroke(LINE); doc.setLineWidth(0.3); doc.roundedRect(M, y, cardW, cardH, 2.5, 2.5, 'FD');
    const cx = M + 24, cy = y + cardH / 2;
    donut(cx, cy, 15, 9.2, [
      { value: g('pending'), color: PAYOUT_TINT.pending },
      { value: g('paid'), color: PAYOUT_TINT.paid },
      { value: g('reverted'), color: PAYOUT_TINT.reverted },
    ]);
    font('bold', 11); ink(INK); doc.text(money(totalGross), cx, cy - 0.5, { align: 'center' });
    font('normal', 6.5); ink(MUTE); doc.text('total', cx, cy + 4, { align: 'center' });
    const legendX = M + 52;
    ['pending', 'paid', 'reverted'].forEach((k, i) => {
      const ly = y + 12 + i * 8;
      fill(PAYOUT_TINT[k]); doc.roundedRect(legendX, ly - 2.6, 3, 3, 0.6, 0.6, 'F');
      font('normal', 8.5); ink(SLATE); doc.text(PAYOUT_LABEL[k], legendX + 5, ly);
      font('bold', 8.5); ink(INK); doc.text(`${money(g(k))}  ·  ${c(k)}`, legendX + 60, ly);
    });
    y += cardH + 9;
  }

  // ── row table ──────────────────────────────────────────────────────────────
  // Widths total 269mm = the landscape text column (297 - 2*14). Adding Sale
  // Reference meant trimming the others rather than overflowing the page.
  const cols = [
    { k: 'sale_date',         label: 'Sale Date',      w: 15, align: 'left' },
    { k: 'company_name',      label: 'Company',        w: 25, align: 'left' },
    { k: 'customer_name',     label: 'Customer',       w: 26, align: 'left' },
    { k: 'customer_phone',    label: 'Phone',          w: 21, align: 'left' },
    { k: 'reference_no',      label: 'Sale Reference', w: 18, align: 'left' },
    { k: 'client_name',       label: 'Client',         w: 18, align: 'left' },
    { k: 'fronter_name',      label: 'Fronter',        w: 22, align: 'left' },
    { k: 'closer_name',       label: 'Closer',         w: 22, align: 'left' },
    { k: 'down_payment',      label: 'Down Payment',   w: 17, align: 'right' },
    { k: 'plan',              label: 'Plan',           w: 14, align: 'left' },
    { k: 'status',            label: 'Status',         w: 18, align: 'left' },
    { k: 'payout_status',     label: 'DP Status',      w: 14, align: 'left' },
    { k: 'payout_confirmed',  label: 'Payout Status',  w: 14, align: 'left' },
    { k: 'paid_to_closer',    label: 'Paid Closer',    w: 12, align: 'left' },
    { k: 'paid_to_partner',   label: 'Paid Partner',   w: 13, align: 'left' },
  ];
  const rowH = 6.6;
  const tableHead = () => {
    fill(INK); doc.roundedRect(M, y, W - 2 * M, rowH, 1, 1, 'F');
    font('bold', 7); ink('#ffffff'); let cx = M + 2;
    cols.forEach(col => { doc.text(col.label, col.align === 'right' ? cx + col.w - 2 : cx, y + 4.4, { align: col.align }); cx += col.w; });
    y += rowH;
  };

  heading(`Sales (${rows.length.toLocaleString()})`, BLUE);
  if (!rows.length) {
    font('normal', 9); ink(FAINT); doc.text('No sales match the current filters.', M, y + 4); y += 10;
  } else {
    tableHead();
    rows.forEach((s, idx) => {
      if (y + rowH > H - 16) { newPageTop(); tableHead(); }
      if (idx % 2) { fill(ZEBRA); doc.rect(M, y, W - 2 * M, rowH, 'F'); }
      const statusText = labelOf ? labelOf(s.status) : (s.status || '').replace(/_/g, ' ');
      const statusCell = CANCEL_LIKE.has(s.status) && s.cancellation_date
        ? `${statusText} (${fmtSaleDate(s.cancellation_date)})` : statusText;
      const payoutTint = PAYOUT_TINT[s.payout_status] || MUTE;
      let cx = M + 2;
      cols.forEach(col => {
        let text, tint = INK, style = 'normal';
        if (col.k === 'sale_date') text = s.sale_date ? fmtSaleDate(s.sale_date) : '—';
        else if (col.k === 'down_payment') { text = s.down_payment ? money(s.down_payment) : '—'; style = 'bold'; }
        else if (col.k === 'status') { text = statusCell; }
        else if (col.k === 'payout_status') { text = PAYOUT_LABEL[s.payout_status] || s.payout_status || 'Pending'; tint = payoutTint; style = 'bold'; }
        else if (col.k === 'payout_confirmed') { text = PAYOUT_CONFIRMED_LABEL[s.payout_confirmed] || 'Pending'; tint = PAYOUT_CONFIRMED_TINT[s.payout_confirmed] || AMBER; style = 'bold'; }
        // company arrives as the joined companies{name} on /compliance/sales
        else if (col.k === 'company_name') text = s.companies?.name || s.company_name || '—';
        else if (col.k === 'paid_to_closer' || col.k === 'paid_to_partner') {
          const on = !!s[col.k]; text = on ? 'Yes' : 'No'; tint = on ? GREEN : MUTE; style = on ? 'bold' : 'normal';
        }
        else text = s[col.k] || '—';
        font(style, 7); ink(tint);
        doc.text(clip(text, col.w - 2, 7, style), col.align === 'right' ? cx + col.w - 2 : cx, y + 4.4, { align: col.align });
        cx += col.w;
      });
      stroke(LINE); doc.setLineWidth(0.1); doc.line(M, y + rowH, W - M, y + rowH);
      y += rowH;
    });
  }

  // ── footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(LINE); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
    font('normal', 7); ink(FAINT);
    doc.text(`${getBrandName()} · Payouts`, M, H - 8);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }

  doc.save(buildFilename({ dataset: 'payout-report', scope: companyName, dateFrom: filters.date_from, dateTo: filters.date_to, ext: 'pdf' }));
}
