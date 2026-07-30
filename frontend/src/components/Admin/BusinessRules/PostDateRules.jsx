import { useState, useEffect } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import ThemedSelect from '../../UI/Select';
import { DEFAULT_POST_DATE_FAIL_REASONS } from '../../../hooks/usePostDateFailReasons';

// Business Rules → Post Dates. The vocabulary a closer picks from when the card
// on a post-dated sale does NOT go through on the charge day.
//
// Configurable rather than hardcoded because every other vocabulary in this app
// already is (form_fields, dispositions, cancellation_reasons, the compliance
// status catalog), and the first company that wants "ACH returned" on the menu
// should not need a deploy.
//
// Disabling an entry hides it from new picks but keeps the label resolvable on
// historical attempts — reason_key is stored as free text on post_date_attempts
// exactly so retiring a reason never orphans a record.
const KEY = 'post_date_fail_reasons';

const CATEGORIES = ['payment', 'customer', 'other'];
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const PostDateRules = ({ config, onSave }) => {
  const initial = Array.isArray(config?.[KEY]) && config[KEY].length ? config[KEY] : DEFAULT_POST_DATE_FAIL_REASONS;
  const [rows, setRows] = useState(initial);
  useEffect(() => {
    setRows(Array.isArray(config?.[KEY]) && config[KEY].length ? config[KEY] : DEFAULT_POST_DATE_FAIL_REASONS);
  }, [config]);

  const push = (next) => { setRows(next); onSave(KEY, next); };
  const setRow = (i, patch) => push(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => push(rows.filter((_, j) => j !== i));
  const add = () => push([...rows, { key: '', label: '', category: 'other', enabled: true }]);
  const resetDefault = () => push(DEFAULT_POST_DATE_FAIL_REASONS);

  const amber = '#f59e0b';
  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: `3px solid ${amber}` };

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock size={18} style={{ color: amber }} />
          <h2 className="text-base font-bold text-text">Post Dates</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">
          A post-dated sale is a <b>reminder, not a sale</b> — the card has not been charged, and it counts toward
          nothing until it is. On the charge day the closer either takes the payment (it becomes a real sale) or picks
          one of these reasons and a new date. The record stays in their Post Date tab and the reminder re-arms.
          Compliance sees every attempt on the sale record.
        </p>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_120px_70px_auto] gap-2 px-1 text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
            <span>Label</span><span>Key</span><span>Group</span><span>On</span><span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_120px_70px_auto] gap-2 items-center p-2 rounded-xl"
              style={{ background: 'var(--color-bg-secondary)' }}>
              <input type="text" value={r.label || ''} placeholder="Card declined"
                onChange={e => setRow(i, { label: e.target.value })}
                className="input text-sm py-1" />
              {/* The key is what lands on post_date_attempts.reason_key, so
                  editing it on an existing entry orphans the label on rows
                  already recorded with the old one. Auto-filled from the label
                  only while still blank. */}
              <input type="text" value={r.key || ''} placeholder="declined_card"
                onChange={e => setRow(i, { key: slug(e.target.value) })}
                onBlur={() => { if (!r.key && r.label) setRow(i, { key: slug(r.label) }); }}
                className="input text-sm py-1 font-mono" />
              <ThemedSelect value={r.category || 'other'} onChange={e => setRow(i, { category: e.target.value })}
                className="input text-sm py-1">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </ThemedSelect>
              <label className="flex items-center justify-center cursor-pointer">
                <input type="checkbox" checked={r.enabled !== false}
                  onChange={e => setRow(i, { enabled: e.target.checked })}
                  className="w-4 h-4" style={{ accentColor: amber }} />
              </label>
              <button onClick={() => remove(i)} className="p-1.5 rounded" style={{ color: '#ef4444' }}
                title="Remove — prefer switching it off, which keeps old records readable"
                disabled={rows.length <= 1}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={add} className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: '#b45309', background: 'color-mix(in srgb, #f59e0b 14%, transparent)' }}>
            <Plus size={14} /> Add reason
          </button>
        </div>

        <p className="text-[11px] mt-4 mb-0" style={{ color: 'var(--color-text-tertiary)' }}>
          Switching a reason <b>off</b> hides it from new picks but keeps it readable on attempts already recorded.
          Deleting it does the same for future picks — the old records keep the raw key as their label.
        </p>

        <button onClick={resetDefault} className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
};

export default PostDateRules;
