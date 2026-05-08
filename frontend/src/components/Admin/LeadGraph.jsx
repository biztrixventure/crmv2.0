import { useEffect, useRef, useCallback } from 'react';
import cytoscape from 'cytoscape';

// ── Node type visual config ───────────────────────────────────────────────────
const NODE_STYLES = [
  {
    selector: 'node',
    style: {
      label:                     'data(label)',
      'text-valign':             'bottom',
      'text-halign':             'center',
      'font-size':               '9px',
      'font-family':             'ui-sans-serif, system-ui, sans-serif',
      'text-wrap':               'wrap',
      'text-max-width':          '72px',
      color:                     '#1f2937',
      'text-background-color':   '#fff',
      'text-background-opacity': 0.88,
      'text-background-padding': '1px',
      'border-width':            2,
      'border-color':            '#e5e7eb',
      width:                     40,
      height:                    40,
      'background-color':        '#9ca3af',
    },
  },
  // ── Lead (center) — large purple
  {
    selector: 'node[type="lead"]',
    style: {
      'background-color':  '#7c3aed',
      'border-color':      '#5b21b6',
      'border-width':      3,
      width:               64,
      height:              64,
      'font-size':         '10px',
      'font-weight':       'bold',
      'text-background-color': '#ede9fe',
    },
  },
  // ── Transfer — blue rounded rectangle
  {
    selector: 'node[type="transfer"]',
    style: {
      'background-color': '#2563eb',
      'border-color':     '#1e40af',
      shape:              'roundrectangle',
      width:              54,
      height:             38,
    },
  },
  // ── Sale — green circle
  {
    selector: 'node[type="sale"]',
    style: {
      'background-color': '#16a34a',
      'border-color':     '#14532d',
    },
  },
  // ── Callback — amber ellipse
  {
    selector: 'node[type="callback"]',
    style: {
      'background-color': '#d97706',
      'border-color':     '#92400e',
      shape:              'ellipse',
    },
  },
  // ── Agent — light gray, person-shaped (round)
  {
    selector: 'node[type="agent"]',
    style: {
      'background-color': '#f3f4f6',
      'border-color':     '#6b7280',
      'border-width':     2,
      width:              36,
      height:             36,
      color:              '#111827',
    },
  },
  // ── Fronter company — cyan diamond
  {
    selector: 'node[type="fronter_company"]',
    style: {
      'background-color': '#0891b2',
      'border-color':     '#155e75',
      shape:              'diamond',
      width:              50,
      height:             50,
    },
  },
  // ── Closer company — indigo hexagon (tag shape)
  {
    selector: 'node[type="closer_company"]',
    style: {
      'background-color': '#4f46e5',
      'border-color':     '#3730a3',
      shape:              'tag',
      width:              50,
      height:             44,
    },
  },
  // ── Compliance — red/orange pentagon
  {
    selector: 'node[type="compliance"]',
    style: {
      'background-color': '#dc2626',
      'border-color':     '#7f1d1d',
      shape:              'pentagon',
      width:              42,
      height:             42,
    },
  },
  // ── Selected node
  {
    selector: 'node:selected',
    style: {
      'border-width':       4,
      'border-color':       '#f59e0b',
      'overlay-color':      '#fef3c7',
      'overlay-opacity':    0.15,
      'overlay-padding':    4,
    },
  },
  // ── Edges
  {
    selector: 'edge',
    style: {
      label:                    'data(label)',
      'font-size':              '8px',
      'font-family':            'ui-sans-serif, sans-serif',
      'curve-style':            'bezier',
      'target-arrow-shape':     'triangle',
      'line-color':             '#d1d5db',
      'target-arrow-color':     '#d1d5db',
      color:                    '#6b7280',
      'text-background-color':  '#fff',
      'text-background-opacity': 0.9,
      'text-background-padding': '1px',
      width:                    1.5,
    },
  },
  // "converted to" edge — green dashed
  {
    selector: 'edge[label="converted to"]',
    style: {
      'line-color':         '#16a34a',
      'target-arrow-color': '#16a34a',
      'line-style':         'dashed',
      color:                '#16a34a',
      width:                2,
    },
  },
  // "approved" edge — green
  {
    selector: 'edge[label="approved"]',
    style: {
      'line-color':         '#16a34a',
      'target-arrow-color': '#16a34a',
      color:                '#16a34a',
      width:                2,
    },
  },
  // "returned" edge — red
  {
    selector: 'edge[label="returned"]',
    style: {
      'line-color':         '#dc2626',
      'target-arrow-color': '#dc2626',
      'line-style':         'dashed',
      color:                '#dc2626',
      width:                2,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color':         '#f59e0b',
      'target-arrow-color': '#f59e0b',
    },
  },
];

const LEGEND = [
  { type: 'lead',           label: 'Lead',             color: '#7c3aed' },
  { type: 'transfer',       label: 'Transfer',          color: '#2563eb' },
  { type: 'sale',           label: 'Sale',              color: '#16a34a' },
  { type: 'callback',       label: 'Callback',          color: '#d97706' },
  { type: 'agent',          label: 'Agent',             color: '#6b7280' },
  { type: 'fronter_company',label: 'Fronter Co.',       color: '#0891b2' },
  { type: 'closer_company', label: 'Closer Co.',        color: '#4f46e5' },
  { type: 'compliance',     label: 'Compliance',        color: '#dc2626' },
];

const LeadGraph = ({ nodes, edges }) => {
  const containerRef = useRef(null);
  const cyRef        = useRef(null);

  const initGraph = useCallback(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    if (!nodes?.length) return;

    // Find the lead node ID for concentric center
    const leadNode = nodes.find(n => n.data?.type === 'lead');

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [
        ...nodes.map(n => ({ data: n.data })),
        ...edges.map(e => ({ data: e.data })),
      ],
      style: NODE_STYLES,
      layout: {
        name:         'concentric',
        // Rings: lead = center, records = ring 2, agents = ring 3, companies = outer
        concentric: (node) => {
          const type = node.data('type');
          if (type === 'lead')                           return 6;
          if (type === 'transfer')                       return 5;
          if (type === 'sale')                           return 4;
          if (type === 'callback')                       return 4;
          if (type === 'agent')                          return 3;
          if (type === 'compliance')                     return 2;
          if (type === 'fronter_company')                return 1;
          if (type === 'closer_company')                 return 1;
          return 0;
        },
        levelWidth:     () => 3,
        minNodeSpacing: 50,
        padding:        50,
        animate:        true,
        animationDuration: 700,
        fit:            true,
        startAngle:     (3 / 2) * Math.PI, // start at top
        clockwise:      true,
      },
      wheelSensitivity:   0.3,
      minZoom:            0.25,
      maxZoom:            4,
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    // Hover highlight
    cyRef.current.on('mouseover', 'node', (e) => {
      e.target.style({ 'border-width': 3, 'border-color': '#f59e0b' });
    });
    cyRef.current.on('mouseout', 'node', (e) => {
      if (!e.target.selected()) {
        const defaultBorders = {
          lead: '#5b21b6', transfer: '#1e40af', sale: '#14532d',
          callback: '#92400e', agent: '#6b7280',
          fronter_company: '#155e75', closer_company: '#3730a3',
          compliance: '#7f1d1d',
        };
        const type = e.target.data('type');
        e.target.style({ 'border-width': 2, 'border-color': defaultBorders[type] || '#e5e7eb' });
      }
    });

  }, [nodes, edges]);

  useEffect(() => {
    initGraph();
    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; } };
  }, [initGraph]);

  const handleFit   = () => { cyRef.current?.fit(undefined, 40); };
  const handleReset = () => {
    cyRef.current?.layout({
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
      levelWidth: () => 3, minNodeSpacing: 50, padding: 50,
      animate: true, animationDuration: 600, fit: true,
    }).run();
  };

  return (
    <div className="relative rounded-xl overflow-hidden"
      style={{ height: '460px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Controls */}
      <div className="absolute top-2 right-2 flex gap-1.5 z-10">
        <button onClick={handleFit}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Fit
        </button>
        <button onClick={handleReset}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Reset
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 z-10" style={{ maxWidth: '90%' }}>
        {LEGEND.map(l => (
          <div key={l.type} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shadow-sm"
            style={{ backgroundColor: 'rgba(255,255,255,0.93)', border: '1px solid #e5e7eb', color: '#374151' }}>
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      {(!nodes || nodes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No graph data available.</p>
        </div>
      )}
    </div>
  );
};

export default LeadGraph;
