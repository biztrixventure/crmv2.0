import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import cytoscape from 'cytoscape';
import { Maximize2, RotateCcw, Plus, Minus, X, User, ArrowRightLeft, DollarSign, PhoneCall, Building2, ShieldAlert, Circle } from 'lucide-react';

// ── Type meta: color + icon + human label. One source of truth for the graph
// styles, the legend, and the summary chips so everything stays in sync. ───────
const TYPE_META = {
  lead:            { label: 'Lead',        color: '#7c3aed', dark: '#5b21b6', Icon: Circle },
  transfer:        { label: 'Transfer',    color: '#2563eb', dark: '#1e40af', Icon: ArrowRightLeft },
  sale:            { label: 'Sale',        color: '#16a34a', dark: '#14532d', Icon: DollarSign },
  callback:        { label: 'Callback',    color: '#d97706', dark: '#92400e', Icon: PhoneCall },
  agent:           { label: 'Agent',       color: '#64748b', dark: '#334155', Icon: User },
  fronter_company: { label: 'Fronter Co.', color: '#0891b2', dark: '#155e75', Icon: Building2 },
  closer_company:  { label: 'Closer Co.',  color: '#4f46e5', dark: '#3730a3', Icon: Building2 },
  compliance:      { label: 'Compliance',  color: '#dc2626', dark: '#7f1d1d', Icon: ShieldAlert },
};
const metaOf = (t) => TYPE_META[t] || { label: t || 'Node', color: '#9ca3af', dark: '#6b7280', Icon: Circle };

const NODE_STYLES = [
  { selector: 'node', style: {
      label: 'data(label)', 'text-valign': 'bottom', 'text-halign': 'center',
      'font-size': '9px', 'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'text-wrap': 'wrap', 'text-max-width': '78px', color: '#1f2937',
      'text-background-color': '#fff', 'text-background-opacity': 0.9, 'text-background-padding': '2px',
      'text-background-shape': 'roundrectangle',
      'border-width': 2, 'border-color': '#e5e7eb', width: 40, height: 40, 'background-color': '#9ca3af',
      'transition-property': 'opacity, border-width, border-color', 'transition-duration': '120ms',
  } },
  { selector: 'node[type="lead"]', style: { 'background-color': '#7c3aed', 'border-color': '#5b21b6', 'border-width': 3, width: 66, height: 66, 'font-size': '11px', 'font-weight': 'bold', 'text-background-color': '#ede9fe' } },
  { selector: 'node[type="transfer"]', style: { 'background-color': '#2563eb', 'border-color': '#1e40af', shape: 'roundrectangle', width: 54, height: 38 } },
  { selector: 'node[type="sale"]', style: { 'background-color': '#16a34a', 'border-color': '#14532d' } },
  { selector: 'node[type="callback"]', style: { 'background-color': '#d97706', 'border-color': '#92400e', shape: 'ellipse' } },
  { selector: 'node[type="agent"]', style: { 'background-color': '#e2e8f0', 'border-color': '#64748b', 'border-width': 2, width: 36, height: 36, color: '#0f172a' } },
  { selector: 'node[type="fronter_company"]', style: { 'background-color': '#0891b2', 'border-color': '#155e75', shape: 'diamond', width: 52, height: 52 } },
  { selector: 'node[type="closer_company"]', style: { 'background-color': '#4f46e5', 'border-color': '#3730a3', shape: 'tag', width: 52, height: 46 } },
  { selector: 'node[type="compliance"]', style: { 'background-color': '#dc2626', 'border-color': '#7f1d1d', shape: 'pentagon', width: 44, height: 44 } },
  // status ring accents
  { selector: 'node[status="cancelled"]', style: { 'border-color': '#dc2626' } },
  { selector: 'node[status="closed_won"]', style: { 'border-color': '#15803d' } },
  { selector: 'node:selected', style: { 'border-width': 5, 'border-color': '#f59e0b' } },
  { selector: 'edge', style: {
      label: 'data(label)', 'font-size': '8px', 'font-family': 'ui-sans-serif, sans-serif', 'curve-style': 'bezier',
      'target-arrow-shape': 'triangle', 'line-color': '#cbd5e1', 'target-arrow-color': '#cbd5e1', color: '#94a3b8',
      'text-background-color': '#fff', 'text-background-opacity': 0.85, 'text-background-padding': '1px', width: 1.5,
      'transition-property': 'opacity, line-color, width', 'transition-duration': '120ms',
  } },
  { selector: 'edge[label="converted to"]', style: { 'line-color': '#16a34a', 'target-arrow-color': '#16a34a', 'line-style': 'dashed', color: '#16a34a', width: 2 } },
  { selector: 'edge[label="approved"]', style: { 'line-color': '#16a34a', 'target-arrow-color': '#16a34a', color: '#16a34a', width: 2 } },
  { selector: 'edge[label="returned"]', style: { 'line-color': '#dc2626', 'target-arrow-color': '#dc2626', 'line-style': 'dashed', color: '#dc2626', width: 2 } },
  // focus/fade classes for neighborhood highlighting
  { selector: '.faded', style: { opacity: 0.1, 'text-opacity': 0.05 } },
  { selector: 'node.hl', style: { 'border-color': '#f59e0b', 'border-width': 4 } },
  { selector: 'edge.hl', style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', color: '#b45309', width: 3, opacity: 1 } },
];

const LAYOUT = {
  name: 'concentric',
  concentric: (node) => {
    const t = node.data('type');
    if (t === 'lead') return 6;
    if (t === 'transfer') return 5;
    if (t === 'sale' || t === 'callback') return 4;
    if (t === 'agent') return 3;
    if (t === 'compliance') return 2;
    return 1;
  },
  levelWidth: () => 1, minNodeSpacing: 62, padding: 40,
  animate: true, animationDuration: 650, fit: true,
  startAngle: (3 / 2) * Math.PI, clockwise: true,
};

const LeadGraph = ({ nodes, edges }) => {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const selRef = useRef(null);                    // selected node id (survives cy handler closures)
  const [sel, setSel] = useState(null);          // { data, neighbors: [{label,type}] }
  const [activeType, setActiveType] = useState(null);

  // Composition summary — counts per type (drives the chips at the top).
  const counts = useMemo(() => {
    const c = {};
    (nodes || []).forEach(n => { const t = n.data?.type; if (t) c[t] = (c[t] || 0) + 1; });
    return c;
  }, [nodes]);

  const focusNode = useCallback((node) => {
    const cy = cyRef.current; if (!cy) return;
    const hood = node.closedNeighborhood();
    cy.elements().addClass('faded');
    hood.removeClass('faded');
    hood.nodes().addClass('hl'); hood.edges().addClass('hl');
    node.removeClass('hl');
  }, []);
  const clearFocus = useCallback(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.elements().removeClass('faded hl');
  }, []);

  const initGraph = useCallback(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    if (!nodes?.length) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...nodes.map(n => ({ data: n.data })), ...edges.map(e => ({ data: e.data }))],
      style: NODE_STYLES, layout: LAYOUT,
      wheelSensitivity: 0.3, minZoom: 0.2, maxZoom: 4,
    });
    cyRef.current = cy;

    cy.on('mouseover', 'node', (e) => focusNode(e.target));
    cy.on('mouseout', 'node', () => {
      // keep the clicked node's focus when nothing new is hovered
      if (selRef.current) { const n = cy.$id(selRef.current); if (n.nonempty()) { focusNode(n); return; } }
      clearFocus();
    });
    cy.on('tap', 'node', (e) => {
      const n = e.target;
      selRef.current = n.id();
      const neighbors = n.neighborhood('node').map(x => ({ label: x.data('label'), type: x.data('type') }));
      const via = n.connectedEdges().map(x => x.data('label')).filter(Boolean);
      setSel({ data: n.data(), neighbors, via: [...new Set(via)] });
      focusNode(n);
    });
    cy.on('tap', (e) => { if (e.target === cy) { selRef.current = null; setSel(null); clearFocus(); } });
  }, [nodes, edges, focusNode, clearFocus]);

  useEffect(() => {
    initGraph();
    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const runLayout = () => cyRef.current?.layout(LAYOUT).run();
  const zoomBy = (f) => { const cy = cyRef.current; if (cy) cy.zoom({ level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); };
  const fit = () => cyRef.current?.fit(undefined, 40);

  // Clicking a summary chip highlights all nodes of that type.
  const toggleType = (t) => {
    const cy = cyRef.current; if (!cy) return;
    if (activeType === t) { setActiveType(null); clearFocus(); return; }
    setActiveType(t); setSel(null);
    cy.elements().addClass('faded');
    const sub = cy.nodes(`[type="${t}"]`);
    sub.removeClass('faded').addClass('hl');
    sub.connectedEdges().removeClass('faded');
  };

  const Btn = ({ onClick, title, children }) => (
    <button onClick={onClick} title={title}
      className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
      {children}
    </button>
  );

  const selMeta = sel ? metaOf(sel.data.type) : null;

  return (
    <div>
      {/* ── Composition summary — the whole graph at a glance ────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {Object.entries(TYPE_META).map(([type, m]) => {
          const n = counts[type] || 0;
          if (!n) return null;
          const on = activeType === type;
          const Icon = m.Icon;
          return (
            <button key={type} onClick={() => toggleType(type)}
              className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full text-xs font-semibold transition-all"
              style={on
                ? { background: m.color, color: '#fff', border: `1px solid ${m.color}` }
                : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              title={`${n} ${m.label}${n === 1 ? '' : 's'} — click to highlight`}>
              <span className="w-4 h-4 rounded-full inline-flex items-center justify-center" style={{ background: on ? 'rgba(255,255,255,0.25)' : `${m.color}22`, color: on ? '#fff' : m.color }}>
                <Icon size={10} />
              </span>
              {m.label}
              <span className="tabular-nums font-bold px-1 rounded" style={{ background: on ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-secondary)' }}>{n}</span>
            </button>
          );
        })}
        {activeType && (
          <button onClick={() => { setActiveType(null); clearFocus(); }} className="text-[11px] font-semibold px-2 py-1 rounded-full" style={{ color: 'var(--color-text-tertiary)' }}>clear</button>
        )}
      </div>

      <div className="relative rounded-xl overflow-hidden"
        style={{ height: '540px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Controls */}
        <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
          <Btn onClick={() => zoomBy(1.25)} title="Zoom in"><Plus size={15} /></Btn>
          <Btn onClick={() => zoomBy(0.8)} title="Zoom out"><Minus size={15} /></Btn>
          <Btn onClick={fit} title="Fit to view"><Maximize2 size={14} /></Btn>
          <Btn onClick={runLayout} title="Re-layout"><RotateCcw size={14} /></Btn>
        </div>

        {/* Hint */}
        <div className="absolute top-2 left-2 z-10 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.9)', color: '#475569', border: '1px solid #e5e7eb' }}>
          Hover a node to trace its links · click to inspect · scroll to zoom
        </div>

        {/* Selected-node detail panel */}
        {sel && selMeta && (
          <div className="absolute top-12 right-2 z-20 rounded-xl shadow-lg" style={{ width: 240, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-t-xl" style={{ background: selMeta.color }}>
              <selMeta.Icon size={15} color="#fff" />
              <span className="text-xs font-bold text-white flex-1">{selMeta.label}</span>
              <button onClick={() => { selRef.current = null; setSel(null); clearFocus(); }}><X size={15} color="#fff" /></button>
            </div>
            <div className="p-3 space-y-2">
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{String(sel.data.label || '').replace(/\n/g, ' · ')}</div>
              {sel.data.status && <div className="text-[11px]"><span style={{ color: 'var(--color-text-tertiary)' }}>Status: </span><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{String(sel.data.status).replace(/_/g, ' ')}</span></div>}
              {sel.data.role && <div className="text-[11px]"><span style={{ color: 'var(--color-text-tertiary)' }}>Role: </span><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{sel.data.role}</span></div>}
              {sel.via?.length > 0 && (
                <div className="text-[11px]"><span style={{ color: 'var(--color-text-tertiary)' }}>Links: </span><span style={{ color: 'var(--color-text-secondary)' }}>{sel.via.join(', ')}</span></div>
              )}
              {sel.neighbors?.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Connected to ({sel.neighbors.length})</div>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-auto">
                    {sel.neighbors.map((nb, i) => {
                      const m = metaOf(nb.type);
                      return <span key={i} className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={{ background: `${m.color}18`, color: m.color }}><m.Icon size={9} />{String(nb.label || '').split('\n')[0]}</span>;
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {(!nodes || nodes.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No graph data available.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadGraph;
