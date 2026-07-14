// ── QA agent-performance PDF ─────────────────────────────────────────────────
// A compact, good-looking, SMALL report built from the same /qa/reports data the
// Reports tab renders. Everything is drawn with jsPDF VECTOR primitives (text,
// rects, lines) and the built-in Helvetica font — no rasterized charts, no
// embedded fonts — so the file stays a few KB even with many agents.
//
// The report is intentionally section-based (header → KPIs → charts → table) so
// when the Reports layout changes later, only the section builders here change.
import { jsPDF } from 'jspdf';

const INK = '#0f172a', MUTE = '#64748b', LINE = '#e2e8f0';
const BLUE = '#2563eb', GREEN = '#16a34a', RED = '#dc2626', AMBER = '#d97706';
const hx = (h) => { const n = h.replace('#', ''); return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]; };

const fmt = (v, suffix = '') => (v == null || v === '' ? '—' : `${v}${suffix}`);
const clip = (doc, s, w, size) => {
  s = String(s ?? '');
  if (doc.getTextWidth(s) <= w) return s;
  while (s.length > 1 && doc.getTextWidth(s + '…') > w) s = s.slice(0, -1);
  return s + '…';
};

export function exportQaReportPdf({ data, filters = {}, companyName = '' } = {}) {
  const s = data?.summary || {};
  const agents = (data?.by_agent || []).slice();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, M = 14;
  let y = 0;

  const setFill = (h) => { const [r, g, b] = hx(h); doc.setFillColor(r, g, b); };
  const setText = (h) => { const [r, g, b] = hx(h); doc.setTextColor(r, g, b); };
  const setDraw = (h) => { const [r, g, b] = hx(h); doc.setDrawColor(r, g, b); };

  // ── header band ────────────────────────────────────────────────────────────
  setFill(INK); doc.rect(0, 0, W, 26, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setText('#ffffff');
  doc.text('QA Agent Performance', M, 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText('#cbd5e1');
  const sub = [companyName || null, filters.method ? `Section: ${filters.method.toUpperCase()}` : 'All sections',
    (filters.date_from && filters.date_to) ? `${filters.date_from} → ${filters.date_to}` : null].filter(Boolean).join('   ·   ');
  doc.text(sub, M, 19);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  doc.text(`Generated ${stamp}`, W - M, 19, { align: 'right' });
  y = 34;

  // ── KPI cards ────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'REVIEWS', value: fmt(s.reviews || 0), tint: INK },
    { label: 'PASS RATE', value: fmt(s.pass_rate ?? 0, '%'), tint: (s.pass_rate || 0) >= 80 ? GREEN : RED },
    { label: 'AVG SCORE', value: fmt(s.avg_score ?? 0, '%'), tint: BLUE },
    { label: 'PASSED', value: fmt(s.passed || 0), tint: GREEN },
    { label: 'FAILED', value: fmt(s.failed || 0), tint: RED },
  ];
  const gap = 3, kw = (W - 2 * M - gap * (kpis.length - 1)) / kpis.length, kh = 18;
  kpis.forEach((k, i) => {
    const x = M + i * (kw + gap);
    setFill('#f8fafc'); setDraw(LINE); doc.setLineWidth(0.2);
    doc.roundedRect(x, y, kw, kh, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); setText(MUTE);
    doc.text(k.label, x + 3, y + 6);
    doc.setFontSize(15); setText(k.tint);
    doc.text(String(k.value), x + 3, y + 14);
  });
  y += kh + 8;

  // ── section: Top agents by avg score (horizontal bars) ───────────────────────
  const sectionTitle = (t) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setText(INK); doc.text(t, M, y); y += 5; };
  const topAgents = agents.slice().sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0)).slice(0, 10);
  if (topAgents.length) {
    sectionTitle('Average score by agent (top 10)');
    const barX = M + 42, barW = W - M - barX - 14, rowH = 6.6;
    topAgents.forEach((a) => {
      const v = Math.max(0, Math.min(100, a.avg_score || 0));
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setText(INK);
      doc.text(clip(doc, a.name, 40, 7.5), M, y + 4);
      setFill('#eef2f7'); doc.roundedRect(barX, y + 1, barW, 4, 1, 1, 'F');
      const tint = v >= 80 ? GREEN : v >= 60 ? AMBER : RED;
      setFill(tint); doc.roundedRect(barX, y + 1, Math.max(1.2, barW * v / 100), 4, 1, 1, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setText(tint);
      doc.text(`${v}%`, barX + barW + 2, y + 4.4);
      y += rowH;
    });
    y += 4;
  }

  // ── section: Pass vs Fail + Score distribution (compact stacked bars) ────────
  const passed = s.passed || 0, failed = s.failed || 0, tot = passed + failed;
  if (tot) {
    sectionTitle('Pass vs Fail');
    const bx = M, bw = W - 2 * M, bh = 7;
    const pw = bw * passed / tot;
    setFill(GREEN); doc.roundedRect(bx, y, Math.max(pw, 0.5), bh, 1, 1, 'F');
    setFill(RED); doc.roundedRect(bx + pw, y, Math.max(bw - pw, 0.5), bh, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setText('#ffffff');
    if (pw > 16) doc.text(`Pass ${passed}`, bx + 3, y + 4.8);
    if (bw - pw > 16) doc.text(`Fail ${failed}`, bx + pw + 3, y + 4.8);
    y += bh + 8;
  }

  const buckets = data?.buckets || [];
  if (buckets.length) {
    sectionTitle('Score distribution');
    const maxN = Math.max(1, ...buckets.map(b => b.n || 0));
    const cw = (W - 2 * M) / buckets.length, chH = 22;
    const baseY = y + chH;
    buckets.forEach((b, i) => {
      const bh = (chH - 4) * (b.n || 0) / maxN;
      const x = M + i * cw + cw * 0.2, w = cw * 0.6;
      setFill(['#dc2626', '#d97706', '#2563eb', '#16a34a'][i] || BLUE);
      doc.roundedRect(x, baseY - bh, w, Math.max(bh, 0.5), 0.8, 0.8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); setText(INK);
      doc.text(String(b.n || 0), x + w / 2, baseY - bh - 1.5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); setText(MUTE);
      doc.text(clip(doc, b.label, cw - 2, 6.5), x + w / 2, baseY + 4, { align: 'center' });
    });
    y = baseY + 9;
  }

  // ── table: every reviewed agent ──────────────────────────────────────────────
  const cols = [
    { k: 'name', label: 'Agent reviewed', w: 78, align: 'left' },
    { k: 'reviews', label: 'Reviews', w: 26, align: 'right' },
    { k: 'passed', label: 'Passed', w: 26, align: 'right' },
    { k: 'pass_rate', label: 'Pass rate', w: 30, align: 'right', suffix: '%' },
    { k: 'avg_score', label: 'Avg score', w: 22, align: 'right', suffix: '%' },
  ];
  const tableX = M, rowH = 6.2;
  const header = () => {
    setFill('#f1f5f9'); doc.rect(tableX, y, W - 2 * M, rowH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setText(MUTE);
    let cx = tableX + 2;
    cols.forEach(c => { doc.text(c.label, c.align === 'right' ? cx + c.w - 2 : cx, y + 4.2, { align: c.align }); cx += c.w; });
    y += rowH;
  };
  const ensure = (need) => { if (y + need > 286) { doc.addPage(); y = 16; header(); } };

  if (agents.length) {
    sectionTitle(`All agents (${agents.length})`);
    header();
    agents.forEach((a, idx) => {
      ensure(rowH);
      if (idx % 2) { setFill('#fafcfe'); doc.rect(tableX, y, W - 2 * M, rowH, 'F'); }
      let cx = tableX + 2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setText(INK);
      cols.forEach(c => {
        let v = a[c.k];
        if (c.k === 'pass_rate') v = v == null ? '—' : `${v}${c.suffix}`;
        else if (c.suffix && v != null) v = `${v}${c.suffix}`;
        const txt = c.k === 'name' ? clip(doc, v, c.w - 3, 7.5) : String(v ?? '—');
        if (c.k === 'pass_rate' && a.pass_rate != null) setText(a.pass_rate >= 80 ? GREEN : RED); else setText(INK);
        doc.text(txt, c.align === 'right' ? cx + c.w - 2 : cx, y + 4.2, { align: c.align });
        cx += c.w;
      });
      setDraw(LINE); doc.setLineWidth(0.1); doc.line(tableX, y + rowH, W - M, y + rowH);
      y += rowH;
    });
  }

  // ── footer (page numbers) ────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setText(MUTE);
    doc.text('BizTrix CRM · QA', M, 293);
    doc.text(`Page ${p} / ${pages}`, W - M, 293, { align: 'right' });
  }

  const safe = (companyName || 'company').replace(/[^\w-]+/g, '_').slice(0, 24);
  doc.save(`qa-agent-report_${safe}_${filters.date_from || ''}_${filters.date_to || ''}.pdf`);
}
