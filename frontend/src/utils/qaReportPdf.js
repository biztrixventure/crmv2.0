// ── QA agent-performance PDF ─────────────────────────────────────────────────
// A polished, good-looking, SMALL report built from the same /qa/reports data the
// Reports tab renders. Everything is drawn with jsPDF VECTOR primitives (text,
// rects, triangle-fan donuts, lines) and the built-in Helvetica font — no
// rasterized charts, no embedded fonts — so the file stays a few KB even with
// many agents and looks crisp at any zoom.
//
// Section-based (header → KPIs → charts → agent bars → table) so when the Reports
// layout changes later, only the section builders here change.
import { jsPDF } from 'jspdf';

const INK = '#0f172a', SLATE = '#334155', MUTE = '#64748b', FAINT = '#94a3b8';
const LINE = '#e2e8f0', WASH = '#f8fafc', ZEBRA = '#fbfdff';
const BLUE = '#2563eb', VIOLET = '#7c3aed', GREEN = '#16a34a', RED = '#dc2626', AMBER = '#d97706';
const hx = (h) => { const n = h.replace('#', ''); return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]; };
const scoreTint = (v) => (v >= 85 ? GREEN : v >= 70 ? '#65a30d' : v >= 55 ? AMBER : RED);
const fmt = (v, suffix = '') => (v == null || v === '' ? '—' : `${v}${suffix}`);

export function exportQaReportPdf({ data, filters = {}, companyName = '' } = {}) {
  const s = data?.summary || {};
  const agents = (data?.by_agent || []).slice();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 14;
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
  // triangle-fan donut (vector, tiny). data:[{value,color}], hole = inner radius.
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
  const newPageTop = () => { doc.addPage(); paintPageFrame(); y = 20; };
  const ensure = (need) => { if (y + need > H - 16) newPageTop(); };
  const paintPageFrame = () => { /* clean white — keeps file tiny; footer added at end */ };

  // ── header band ──────────────────────────────────────────────────────────────
  fill(INK); doc.rect(0, 0, W, 30, 'F');
  fill(VIOLET); doc.rect(0, 30, W, 1.4, 'F');            // accent underline
  font('bold', 17); ink('#ffffff');
  doc.text('QA Agent Performance', M, 13);
  font('normal', 9); ink('#cbd5e1');
  const sub = [companyName || null, filters.method ? `Section: ${String(filters.method).toUpperCase()}` : 'All sections'].filter(Boolean).join('    ·    ');
  doc.text(sub, M, 20);
  if (filters.date_from && filters.date_to) doc.text(`${filters.date_from}  →  ${filters.date_to}`, M, 25.5);
  font('normal', 8); ink('#94a3b8');
  doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, W - M, 25.5, { align: 'right' });
  y = 40;

  // ── KPI cards (top accent bar + big number) ───────────────────────────────────
  const kpis = [
    { label: 'REVIEWS', value: fmt(s.reviews || 0), tint: BLUE },
    { label: 'PASS RATE', value: fmt(s.pass_rate ?? 0, '%'), tint: (s.pass_rate || 0) >= 80 ? GREEN : RED },
    { label: 'AVG SCORE', value: fmt(s.avg_score ?? 0, '%'), tint: scoreTint(s.avg_score || 0) },
    { label: 'PASSED', value: fmt(s.passed || 0), tint: GREEN },
    { label: 'FAILED', value: fmt(s.failed || 0), tint: RED },
  ];
  const gap = 3.5, kw = (W - 2 * M - gap * (kpis.length - 1)) / kpis.length, kh = 22;
  kpis.forEach((k, i) => {
    const x = M + i * (kw + gap);
    fill('#ffffff'); stroke(LINE); doc.setLineWidth(0.3);
    doc.roundedRect(x, y, kw, kh, 2, 2, 'FD');
    fill(k.tint); doc.roundedRect(x, y, kw, 2.4, 2, 2, 'F'); doc.rect(x, y + 1.4, kw, 1, 'F');
    font('bold', 6.5); ink(MUTE); doc.text(k.label, x + 3.5, y + 8.5);
    font('bold', 17); ink(k.tint); doc.text(String(k.value), x + 3.5, y + 17.5);
  });
  y += kh + 9;

  // ── section heading helper ─────────────────────────────────────────────────────
  const heading = (t, tint = VIOLET) => {
    ensure(12);
    fill(tint); doc.circle(M + 1.4, y - 1.2, 1.4, 'F');
    font('bold', 10.5); ink(INK); doc.text(t, M + 5, y);
    const tw = doc.getTextWidth(t);
    stroke(LINE); doc.setLineWidth(0.3); doc.line(M + 8 + tw, y - 1, W - M, y - 1);
    y += 6;
  };

  // ── two donut cards: Pass/Fail + Avg-score gauge ──────────────────────────────
  const passed = s.passed || 0, failed = s.failed || 0, tot = passed + failed;
  heading('Overview');
  const cardH = 44, cardW = (W - 2 * M - gap) / 2;
  const drawCard = (x) => { fill('#ffffff'); stroke(LINE); doc.setLineWidth(0.3); doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'FD'); };
  const legend = (x, ly, items) => { items.forEach((it, i) => { const yy = ly + i * 6; fill(it.color); doc.roundedRect(x, yy - 2.6, 3, 3, 0.6, 0.6, 'F'); font('normal', 8); ink(SLATE); doc.text(`${it.label}`, x + 4.5, yy); font('bold', 8); ink(INK); doc.text(String(it.value), x + cardW / 2 - 6, yy, { align: 'right' }); }); };

  // card 1 — pass vs fail donut
  drawCard(M);
  const c1x = M + 24, c1y = y + cardH / 2;
  if (tot) {
    donut(c1x, c1y, 15, 9.2, [{ value: passed, color: GREEN }, { value: failed, color: RED }]);
    font('bold', 12); ink(INK); doc.text(`${s.pass_rate ?? 0}%`, c1x, c1y - 0.5, { align: 'center' });
    font('normal', 6.5); ink(MUTE); doc.text('pass', c1x, c1y + 4, { align: 'center' });
  } else { font('normal', 8); ink(FAINT); doc.text('No data', c1x, c1y, { align: 'center' }); }
  font('bold', 8); ink(MUTE); doc.text('PASS vs FAIL', M + 4, y + 7);
  legend(M + 44, y + 20, [{ label: 'Passed', color: GREEN, value: passed }, { label: 'Failed', color: RED, value: failed }]);

  // card 2 — avg score gauge
  const x2 = M + cardW + gap;
  drawCard(x2);
  const c2x = x2 + 24, c2y = y + cardH / 2, avg = Math.max(0, Math.min(100, s.avg_score || 0));
  donut(c2x, c2y, 15, 9.2, [{ value: avg, color: scoreTint(avg) }, { value: 100 - avg, color: '#eef2f7' }]);
  font('bold', 12); ink(scoreTint(avg)); doc.text(`${s.avg_score ?? 0}%`, c2x, c2y - 0.5, { align: 'center' });
  font('normal', 6.5); ink(MUTE); doc.text('avg', c2x, c2y + 4, { align: 'center' });
  font('bold', 8); ink(MUTE); doc.text('AVERAGE SCORE', x2 + 4, y + 7);
  font('normal', 8); ink(SLATE);
  doc.text(`${s.reviews || 0} reviews`, x2 + 44, y + 18);
  doc.text(`${passed} passed · ${failed} failed`, x2 + 44, y + 24);
  y += cardH + 9;

  // ── ranked agent bars (top 10 by avg score) ───────────────────────────────────
  const top = agents.slice().sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0)).slice(0, 10);
  if (top.length) {
    heading('Average score by agent — top 10', BLUE);
    const rowH = 8, rankW = 6, nameW = 40, barX = M + rankW + nameW + 2, barW = W - M - barX - 12;
    top.forEach((a, i) => {
      ensure(rowH + 2);
      const v = Math.max(0, Math.min(100, a.avg_score || 0)), tint = scoreTint(v);
      // rank badge
      fill(i < 3 ? VIOLET : '#e2e8f0'); doc.circle(M + 2.4, y + 2, 2.4, 'F');
      font('bold', 7); ink(i < 3 ? '#ffffff' : SLATE); doc.text(String(i + 1), M + 2.4, y + 3.3, { align: 'center' });
      font('normal', 8); ink(INK); doc.text(clip(a.name, nameW, 8), M + rankW + 1, y + 3.3);
      fill('#eef2f7'); doc.roundedRect(barX, y + 0.6, barW, 4.4, 1.2, 1.2, 'F');
      fill(tint); doc.roundedRect(barX, y + 0.6, Math.max(1.4, barW * v / 100), 4.4, 1.2, 1.2, 'F');
      font('bold', 8); ink(tint); doc.text(`${v}%`, barX + barW + 2, y + 3.9);
      font('normal', 6.5); ink(FAINT); doc.text(`${a.reviews} rev`, M + rankW + 1, y + 6.4);
      y += rowH;
    });
    y += 3;
  }

  // ── score distribution (vertical bars) ────────────────────────────────────────
  const buckets = data?.buckets || [];
  if (buckets.length && buckets.some(b => b.n)) {
    heading('Score distribution', AMBER);
    ensure(34);
    const maxN = Math.max(1, ...buckets.map(b => b.n || 0));
    const cw = (W - 2 * M) / buckets.length, chH = 24, baseY = y + chH;
    stroke(LINE); doc.setLineWidth(0.2); doc.line(M, baseY, W - M, baseY);
    buckets.forEach((b, i) => {
      const bh = (chH - 5) * (b.n || 0) / maxN, x = M + i * cw + cw * 0.22, bw = cw * 0.56;
      fill(['#dc2626', '#d97706', '#2563eb', '#16a34a'][i] || BLUE);
      doc.roundedRect(x, baseY - bh, bw, Math.max(bh, 0.6), 1, 1, 'F');
      font('bold', 7.5); ink(INK); doc.text(String(b.n || 0), x + bw / 2, baseY - bh - 1.6, { align: 'center' });
      font('normal', 6.5); ink(MUTE); doc.text(clip(b.label, cw - 2, 6.5), x + bw / 2, baseY + 4, { align: 'center' });
    });
    y = baseY + 10;
  }

  // ── full agent table ──────────────────────────────────────────────────────────
  const cols = [
    { k: 'name', label: 'Agent reviewed', w: 80, align: 'left' },
    { k: 'reviews', label: 'Reviews', w: 24, align: 'right' },
    { k: 'passed', label: 'Passed', w: 24, align: 'right' },
    { k: 'pass_rate', label: 'Pass rate', w: 30, align: 'right' },
    { k: 'avg_score', label: 'Avg', w: 24, align: 'right' },
  ];
  const rowH = 6.6;
  const tableHead = () => {
    fill(INK); doc.roundedRect(M, y, W - 2 * M, rowH, 1, 1, 'F');
    font('bold', 7.5); ink('#ffffff'); let cx = M + 3;
    cols.forEach(c => { doc.text(c.label, c.align === 'right' ? cx + c.w - 3 : cx, y + 4.4, { align: c.align }); cx += c.w; });
    y += rowH;
  };
  if (agents.length) {
    heading(`All reviewed agents (${agents.length})`);
    tableHead();
    agents.forEach((a, idx) => {
      if (y + rowH > H - 16) { newPageTop(); tableHead(); }
      if (idx % 2) { fill(ZEBRA); doc.rect(M, y, W - 2 * M, rowH, 'F'); }
      let cx = M + 3;
      cols.forEach(c => {
        let v = a[c.k], tint = INK, style = 'normal';
        if (c.k === 'pass_rate') { v = a.pass_rate == null ? '—' : `${a.pass_rate}%`; tint = a.pass_rate == null ? FAINT : (a.pass_rate >= 80 ? GREEN : RED); style = 'bold'; }
        else if (c.k === 'avg_score') { v = `${a.avg_score ?? 0}%`; tint = scoreTint(a.avg_score || 0); style = 'bold'; }
        const txt = c.k === 'name' ? clip(v, c.w - 4, 7.5) : String(v ?? '—');
        font(style, 7.5); ink(tint);
        doc.text(txt, c.align === 'right' ? cx + c.w - 3 : cx, y + 4.4, { align: c.align });
        cx += c.w;
      });
      stroke(LINE); doc.setLineWidth(0.1); doc.line(M, y + rowH, W - M, y + rowH);
      y += rowH;
    });
  }

  // ── footer on every page ───────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(LINE); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
    font('normal', 7); ink(FAINT);
    doc.text('BizTrix CRM · Quality Assurance', M, H - 8);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }

  const safe = (companyName || 'company').replace(/[^\w-]+/g, '_').slice(0, 24);
  doc.save(`qa-agent-report_${safe}_${filters.date_from || ''}_${filters.date_to || ''}.pdf`);
}
