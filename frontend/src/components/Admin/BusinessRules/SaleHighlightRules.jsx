import { useState, useEffect } from 'react';
import { Highlighter, Plus, Trash2, Info } from 'lucide-react';
import { DEFAULT_SALE_HIGHLIGHT } from '../../../hooks/useSaleHighlight';

// Business Rules → Sale Highlight. Superadmin sets the colors compliance sees on
// the Sale Records list: rows are tinted by how many LIVE sales share the same
// customer number (deeper = more repeats). Cancelling a sale drops the live
// count, so the tint lightens automatically.
const KEY = 'compliance.sale_highlight';

const SaleHighlightRules = ({ config, onSave }) => {
  const initial = (config?.[KEY] && typeof config[KEY] === 'object') ? config[KEY] : DEFAULT_SALE_HIGHLIGHT;
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal((config?.[KEY] && typeof config[KEY] === 'object') ? config[KEY] : DEFAULT_SALE_HIGHLIGHT); }, [config]);

  const tiers = Array.isArray(val.tiers) ? val.tiers : DEFAULT_SALE_HIGHLIGHT.tiers;
  const push = (next) => { setVal(next); onSave(KEY, next); };
  const setEnabled = (b) => push({ ...val, enabled: b });
  const setTier = (i, patch) => push({ ...val, tiers: tiers.map((t, j) => j === i ? { ...t, ...patch } : t) });
  const addTier = () => {
    const maxMin = tiers.reduce((m, t) => Math.max(m, +t.min || 0), 0);
    push({ ...val, tiers: [...tiers, { min: maxMin + 1, color: '#f59e0b', label: `${maxMin + 1}+ on this number` }] });
  };
  const removeTier = (i) => push({ ...val, tiers: tiers.filter((_, j) => j !== i) });
  const resetDefault = () => push(DEFAULT_SALE_HIGHLIGHT);

  const sorted = [...tiers].sort((a, b) => (+a.min) - (+b.min));
  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid #f59e0b' };
  const rowBg = (n) => { let c = null; for (const t of sorted) if (n >= +t.min) c = t.color; return c; };

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Highlighter size={18} style={{ color: '#f59e0b' }} />
          <h2 className="text-base font-bold text-text">Sale Record Highlight</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">
          On the compliance <b>Sale Records</b> list, tint a row by how many sales share the same customer number —
          counting <b>all</b> records, active <b>and</b> cancelled — with a deeper color for more repeats. Every row on
          that number (active or cancelled) is tinted, and a <b>×N</b> badge shows the total count.
        </p>

        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={val.enabled !== false} onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4" style={{ accentColor: '#f59e0b' }} />
          <span className="text-sm font-semibold text-text">Highlighting {val.enabled !== false ? 'on' : 'off'}</span>
        </label>

        {/* tiers */}
        <div className="space-y-2 mb-3" style={{ opacity: val.enabled !== false ? 1 : 0.5, pointerEvents: val.enabled !== false ? 'auto' : 'none' }}>
          <div className="grid grid-cols-[110px_1fr_auto] gap-3 px-1 text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
            <span>When ≥</span><span>Color</span><span></span>
          </div>
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[110px_1fr_auto] gap-3 items-center p-2 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
              <div className="flex items-center gap-1.5">
                <input type="number" min={2} value={t.min}
                  onChange={e => setTier(i, { min: Math.max(2, +e.target.value || 2) })}
                  className="input text-sm w-16 py-1" />
                <span className="text-xs text-text-tertiary">sales</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={/^#/.test(t.color) ? t.color : '#f59e0b'} onChange={e => setTier(i, { color: e.target.value })}
                  className="w-9 h-9 rounded cursor-pointer" style={{ border: '1px solid var(--color-border)', background: 'none' }} />
                <input type="text" value={t.color} onChange={e => setTier(i, { color: e.target.value })}
                  className="input text-sm py-1 font-mono w-28" placeholder="#fef9c3" />
                <span className="text-xs px-2 py-1 rounded" style={{ background: t.color, color: '#000' }}>preview</span>
              </div>
              <button onClick={() => removeTier(i)} className="p-1.5 rounded" style={{ color: '#ef4444' }} title="Remove tier"
                disabled={tiers.length <= 1}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={addTier} className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: '#b45309', background: '#f59e0b18' }}>
            <Plus size={14} /> Add tier
          </button>
        </div>

        {/* live preview */}
        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary mb-1.5 flex items-center gap-1"><Info size={12} /> Preview</div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {[1, 2, 3, 4, 5, 6].map(n => (
              <div key={n} className="flex items-center justify-between px-4 py-2 text-sm"
                style={{ background: (val.enabled !== false && rowBg(n)) || 'transparent', borderTop: '1px solid var(--color-border)', boxShadow: (val.enabled !== false && rowBg(n)) ? 'inset 3px 0 0 #f59e0b' : 'none' }}>
                <span className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                  Sample customer
                  {n >= 2 && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: '#f59e0b22', color: '#b45309', border: '1px solid #f59e0b55' }}>×{n}</span>}
                </span>
                <span className="text-xs text-text-tertiary">{n} sale{n === 1 ? '' : 's'} on this number</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={resetDefault} className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
};

export default SaleHighlightRules;
