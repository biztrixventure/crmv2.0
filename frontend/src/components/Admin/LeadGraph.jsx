import { useEffect, useRef, useCallback } from 'react';
import cytoscape from 'cytoscape';

const GRAPH_STYLE = [
  {
    selector: 'node',
    style: {
      label:                    'data(label)',
      'text-valign':            'bottom',
      'text-halign':            'center',
      'font-size':              '9px',
      'font-family':            'system-ui, -apple-system, sans-serif',
      'text-wrap':              'wrap',
      'text-max-width':         '70px',
      color:                    '#374151',
      'text-background-color':  '#ffffff',
      'text-background-opacity': 0.85,
      'text-background-padding': '1px',
      'border-width':           2,
      'border-color':           '#d1d5db',
      width:                    42,
      height:                   42,
    },
  },
  {
    selector: 'node[type="lead"]',
    style: {
      'background-color': '#7c3aed',
      'border-color':     '#6d28d9',
      'border-width':     3,
      width:              62,
      height:             62,
      'font-size':        '10px',
      'font-weight':      'bold',
    },
  },
  {
    selector: 'node[type="transfer"]',
    style: {
      'background-color': '#2563eb',
      'border-color':     '#1d4ed8',
      shape:              'roundrectangle',
      width:              52,
      height:             36,
    },
  },
  {
    selector: 'node[type="sale"]',
    style: {
      'background-color': '#16a34a',
      'border-color':     '#15803d',
    },
  },
  {
    selector: 'node[type="callback"]',
    style: {
      'background-color': '#d97706',
      'border-color':     '#b45309',
      shape:              'ellipse',
    },
  },
  {
    selector: 'node[type="agent"]',
    style: {
      'background-color': '#f9fafb',
      'border-color':     '#6b7280',
      width:              36,
      height:             36,
      color:              '#374151',
    },
  },
  {
    selector: 'node[type="company"]',
    style: {
      'background-color': '#0891b2',
      'border-color':     '#0e7490',
      shape:              'diamond',
      width:              50,
      height:             50,
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#f59e0b',
      'overlay-color': '#f59e0b',
      'overlay-opacity': 0.1,
    },
  },
  {
    selector: 'edge',
    style: {
      label:                    'data(label)',
      'font-size':              '8px',
      'font-family':            'system-ui, sans-serif',
      'curve-style':            'bezier',
      'target-arrow-shape':     'triangle',
      'line-color':             '#d1d5db',
      'target-arrow-color':     '#d1d5db',
      color:                    '#9ca3af',
      'text-background-color':  '#ffffff',
      'text-background-opacity': 0.9,
      'text-background-padding': '1px',
      width:                    1.5,
    },
  },
  {
    selector: 'edge[label="converted to"]',
    style: {
      'line-color':           '#16a34a',
      'target-arrow-color':   '#16a34a',
      'line-style':           'dashed',
      color:                  '#16a34a',
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
  { type: 'lead',     label: 'Lead',     color: '#7c3aed' },
  { type: 'transfer', label: 'Transfer', color: '#2563eb' },
  { type: 'sale',     label: 'Sale',     color: '#16a34a' },
  { type: 'callback', label: 'Callback', color: '#d97706' },
  { type: 'agent',    label: 'Agent',    color: '#6b7280' },
  { type: 'company',  label: 'Company',  color: '#0891b2' },
];

const LeadGraph = ({ nodes, edges }) => {
  const containerRef = useRef(null);
  const cyRef        = useRef(null);

  const initGraph = useCallback(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    if (!nodes?.length) return;

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements:  [
        ...nodes.map(n => ({ data: n.data, classes: n.classes || '' })),
        ...edges.map(e => ({ data: e.data })),
      ],
      style: GRAPH_STYLE,
      layout: {
        name:              'cose',
        idealEdgeLength:   120,
        nodeRepulsion:     10000,
        nodeOverlap:       20,
        padding:           40,
        fit:               true,
        animate:           true,
        animationDuration: 600,
        randomize:         false,
        componentSpacing:  50,
        coolingFactor:     0.95,
        gravity:           0.25,
      },
      wheelSensitivity: 0.3,
      minZoom:          0.2,
      maxZoom:          3.5,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    // Highlight connected nodes on hover
    cyRef.current.on('mouseover', 'node', (e) => {
      const node = e.target;
      node.style({ 'border-width': 3, 'border-color': '#f59e0b' });
    });
    cyRef.current.on('mouseout', 'node', (e) => {
      const node = e.target;
      if (!node.selected()) {
        const type = node.data('type');
        const defaults = { lead: '#6d28d9', transfer: '#1d4ed8', sale: '#15803d', callback: '#b45309', agent: '#6b7280', company: '#0e7490' };
        node.style({ 'border-width': 2, 'border-color': defaults[type] || '#d1d5db' });
      }
    });
  }, [nodes, edges]);

  useEffect(() => {
    initGraph();
    return () => {
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    };
  }, [initGraph]);

  const handleFit = () => { if (cyRef.current) cyRef.current.fit(undefined, 30); };
  const handleReset = () => {
    if (!cyRef.current) return;
    cyRef.current.layout({
      name: 'cose', idealEdgeLength: 120, nodeRepulsion: 10000,
      padding: 40, animate: true, animationDuration: 600,
    }).run();
  };

  return (
    <div className="relative rounded-xl overflow-hidden"
      style={{ height: '440px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Controls */}
      <div className="absolute top-2 right-2 flex gap-1.5 z-10">
        <button onClick={handleFit}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm transition-colors hover:bg-bg-secondary"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Fit
        </button>
        <button onClick={handleReset}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm transition-colors hover:bg-bg-secondary"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Reset
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex gap-1.5 flex-wrap z-10">
        {LEGEND.map(l => (
          <div key={l.type}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shadow-sm"
            style={{ backgroundColor: 'rgba(255,255,255,0.92)', border: '1px solid #e5e7eb', color: '#374151' }}>
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Empty state */}
      {(!nodes || nodes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No graph data.</p>
        </div>
      )}
    </div>
  );
};

export default LeadGraph;
