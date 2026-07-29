// ============================================================================
// ColumnHeader — a clickable <th>: sort caret + a filter popover whose controls
// are chosen by the column's TYPE, taken from the catalog. Never from the
// column's name.
//
//   <ColumnHeader tq={tq} colKey="sale_date" label="Sale Date" />
//
// `tq` is a useTableQuery instance. That hook owns all the state; this file is
// only the surface. Server mode and client mode render identically — the only
// difference is where the filtering happens, which the person clicking should
// never be able to tell.
//
// A column with no catalog entry renders as a plain, inert header. That is the
// security property, not a fallback: on a server-backed table the catalog comes
// from the API response, so a column the server will not honour cannot be
// offered, and a column a readonly_admin has masked never appears at all.
//
// The popover is PORTALLED to <body> and positioned against the header cell —
// a <th> is inside TableScroll's overflow container, so an absolutely
// positioned menu would be clipped by the scroller (and would drag the table's
// horizontal scrollbar around on mobile).
//
// Theming: CSS vars only, no hex literals, so it follows light / dark / the
// custom Appearance themes. Every <p> carries m-0 because global.css sets
// `p { margin: 12px 0 }`.
// ============================================================================
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ArrowDown, Filter, X, Check } from 'lucide-react';
import ThemedSelect from './Select';
import ThemedDate from './ThemedDate';

const OP_LABEL = {
  contains: 'contains', starts: 'starts with', ends: 'ends with', eq: 'is exactly',
  in: 'is any of', gte: 'is on or after', lte: 'is on or before', between: 'is between',
  on: 'is on', empty: 'is empty', notempty: 'is not empty',
};
// Default operator per type — the one people mean 90% of the time.
const DEFAULT_OP = { text: 'contains', enum: 'in', uuid: 'in', number: 'gte', date: 'between', bool: 'eq' };

const FIELD = {
  width: '100%', padding: '7px 10px', borderRadius: 10, fontSize: 13,
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)', outline: 'none',
};
const soft = (v, pct) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;

// Human label for an enum value: the caller's option list wins, then a
// title-cased snake_case fallback so a new status is readable before anybody
// adds it to a label map.
const prettify = (v) => String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function ColumnHeader({
  tq,
  colKey,
  label,
  align = 'left',
  className = '',
  style,
  // Optional [{ value, label }] for enum/uuid columns whose vocabulary comes
  // from a catalog the shell already holds (companies, users, dispositions).
  // Falls back to the catalog's own `values`, and the column is filter-less if
  // neither exists — better an inert header than a dropdown of nothing.
  options,
  ...rest
}) {
  const spec = tq?.columns?.[colKey] || null;

  const sortable   = !!spec?.sortable;
  const filterable = !!spec?.filterable && !!spec?.type;
  const type       = spec?.type || 'text';
  const active     = tq?.sort?.by === colKey;
  const current    = tq?.draft?.[colKey] || null;
  const hasFilter  = !!tq?.filters?.[colKey];

  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState(null);
  const thRef  = useRef(null);
  const popRef = useRef(null);

  const enumOptions = useMemo(() => {
    if (Array.isArray(options) && options.length) return options;
    if (Array.isArray(spec?.values)) return spec.values.map((v) => ({ value: v, label: prettify(v) }));
    return [];
  }, [options, spec]);

  const place = useCallback(() => {
    const el = thRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 262;
    // Keep the popover on screen at 320px without letting it push the page
    // horizontally — clamp to the viewport rather than trusting the cell's x.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    setPos({ top: r.bottom + 6, left, width: W });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || thRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // `true` on scroll so it fires for TableScroll's inner scroller too, not
    // just the window — otherwise the popover detaches from its header.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const op = current?.op || DEFAULT_OP[type] || 'contains';
  const set = (patch) => tq.setFilter(colKey, { op, v: current?.v, v2: current?.v2, ...patch });

  const toggleEnum = (value) => {
    const list = Array.isArray(current?.v) ? current.v : (current?.v ? [current.v] : []);
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    tq.setFilter(colKey, next.length ? { op: 'in', v: next } : null);
  };

  const opChoices = (spec?.ops || []).filter((o) => o !== 'empty' && o !== 'notempty');

  return (
    <th
      ref={thRef}
      className={className}
      style={{ textAlign: align, whiteSpace: 'nowrap', ...style }}
      aria-sort={active ? (tq.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      {...rest}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <button
          type="button"
          onClick={sortable ? () => tq.toggleSort(colKey) : undefined}
          disabled={!sortable}
          title={sortable ? `Sort by ${label}` : undefined}
          style={{
            background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit',
            cursor: sortable ? 'pointer' : 'default',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          {label}
          {sortable && active && (tq.sort.dir === 'asc'
            ? <ArrowUp size={11} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />
            : <ArrowDown size={11} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />)}
        </button>

        {filterable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={`Filter ${label}`}
            aria-label={`Filter ${label}`}
            aria-expanded={open}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
              border: '1px solid ' + (hasFilter ? soft('var(--color-primary-600)', 45) : 'transparent'),
              background: hasFilter ? soft('var(--color-primary-600)', 15) : 'transparent',
              color: hasFilter ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
            }}
          >
            <Filter size={10} />
          </button>
        )}
      </span>

      {open && pos && filterable && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 12, padding: 10, boxShadow: '0 10px 30px ' + soft('var(--color-text)', 18),
            fontWeight: 400, textAlign: 'left', whiteSpace: 'normal',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p className="m-0" style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{label}</p>
            <button
              type="button" onClick={() => setOpen(false)} aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 2, lineHeight: 0 }}
            >
              <X size={13} />
            </button>
          </div>

          {/* Operator picker — hidden when there is only one sensible choice. */}
          {opChoices.length > 1 && type !== 'enum' && type !== 'uuid' && (
            <div style={{ marginBottom: 8 }}>
              <ThemedSelect
                value={op}
                onChange={(e) => set({ op: e.target.value, v2: undefined })}
                options={opChoices.map((o) => ({ value: o, label: OP_LABEL[o] || o }))}
                aria-label="Filter condition"
              />
            </div>
          )}

          {type === 'text' && (
            <input
              autoFocus
              value={current?.v ?? ''}
              onChange={(e) => set({ v: e.target.value })}
              placeholder={`${OP_LABEL[op] || 'contains'}…`}
              style={FIELD}
            />
          )}

          {type === 'number' && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                autoFocus type="number" value={current?.v ?? ''}
                onChange={(e) => set({ v: e.target.value })}
                placeholder={op === 'between' ? 'Min' : 'Value'} style={FIELD}
              />
              {op === 'between' && (
                <input
                  type="number" value={current?.v2 ?? ''}
                  onChange={(e) => set({ v2: e.target.value })}
                  placeholder="Max" style={FIELD}
                />
              )}
            </div>
          )}

          {type === 'date' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <ThemedDate
                value={current?.v || ''}
                onChange={(e) => set({ v: e.target.value })}
                placeholder={op === 'between' ? 'From' : 'Pick a date'}
              />
              {op === 'between' && (
                <ThemedDate
                  value={current?.v2 || ''}
                  onChange={(e) => set({ v2: e.target.value })}
                  placeholder="To"
                />
              )}
            </div>
          )}

          {type === 'bool' && (
            <ThemedSelect
              value={current?.v ?? ''}
              onChange={(e) => tq.setFilter(colKey, e.target.value === '' ? null : { op: 'eq', v: e.target.value })}
              options={[{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
              aria-label={label}
            />
          )}

          {(type === 'enum' || type === 'uuid') && (
            enumOptions.length ? (
              <div style={{ maxHeight: 210, overflowY: 'auto', display: 'grid', gap: 2 }}>
                {enumOptions.map((o) => {
                  const list = Array.isArray(current?.v) ? current.v : (current?.v ? [current.v] : []);
                  const on = list.map(String).includes(String(o.value));
                  return (
                    <button
                      key={o.value} type="button" onClick={() => toggleEnum(o.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                        padding: '6px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        fontSize: 12.5, border: 'none',
                        background: on ? soft('var(--color-primary-600)', 12) : 'transparent',
                        color: on ? 'var(--color-primary-600)' : 'var(--color-text)',
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid ' + (on ? 'var(--color-primary-600)' : 'var(--color-border)'),
                        background: on ? 'var(--color-primary-600)' : 'transparent',
                      }}>
                        {on && <Check size={10} style={{ color: 'var(--color-surface)' }} />}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="m-0" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                No values to filter by yet.
              </p>
            )
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
            {(spec?.ops || []).includes('empty') && (
              <button
                type="button"
                onClick={() => tq.setFilter(colKey, current?.op === 'empty' ? null : { op: 'empty' })}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  background: current?.op === 'empty' ? soft('var(--color-primary-600)', 12) : 'transparent',
                  color: current?.op === 'empty' ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                }}
              >
                Blank only
              </button>
            )}
            <button
              type="button"
              onClick={() => { tq.clearFilter(colKey); setOpen(false); }}
              disabled={!current}
              style={{
                flex: 1, padding: '5px 8px', borderRadius: 8, fontSize: 11.5,
                cursor: current ? 'pointer' : 'default', opacity: current ? 1 : 0.5,
                border: '1px solid var(--color-border)', background: 'transparent',
                color: 'var(--color-text-secondary)',
              }}
            >
              Clear
            </button>
          </div>
        </div>,
        document.body,
      )}
    </th>
  );
}
