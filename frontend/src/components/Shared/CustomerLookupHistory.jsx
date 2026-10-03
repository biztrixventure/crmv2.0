// ============================================================================
// CustomerLookupHistory — "what did I search?", for the person who searched it.
//
// The tool used to forget a result the moment the next search replaced it. An
// agent half way through a list of names lost them, and the only way back was
// to spend another search out of their allowance on a number they had already
// looked up.
//
// So every search is on file (mig 337) and this lists them. OPENING ONE IS
// FREE: the saved payload is handed back and drawn in the search tab it came
// from, with nothing sent to the lookup service and nothing taken off the
// allowance. Only a result older than the 30-day payload retention has to be
// run again, and the row says so rather than offering a button that fails.
// ============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { History, RefreshCw, ExternalLink, Search, X } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, EmptyState, PillTabs, Loading } from '../UI/kit';
import { Badge, Button, Alert } from '../UI';
import {
  KIND_LABEL, STATUS_TONE, STATUS_LABEL,
  whenText, exactText, summaryText, canReopen, msText,
} from '../../utils/lookupHistory';

const PAGE = 30;

export default function CustomerLookupHistory({ access, onOpen, openingId, reloadKey }) {
  const [rows, setRows]   = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy]   = useState(true);
  const [err, setErr]     = useState('');
  const [kind, setKind]   = useState('');

  // The box searches the WHOLE row, not just what was typed: the name that came
  // back, the city, the car, the VIN. Debounced rather than Enter-to-search,
  // because looking for a half-remembered name is a typing-and-watching job.
  const [text, setText]   = useState('');
  const [term, setTerm]   = useState('');
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer.current);
  }, [text]);

  const load = useCallback(async (offset = 0) => {
    setBusy(true); setErr('');
    try {
      const r = await client.get('customer-lookup/history', {
        params: { limit: PAGE, offset, kind: kind || undefined, q: term || undefined },
      });
      setRows(prev => (offset ? [...prev, ...(r.data.rows || [])] : (r.data.rows || [])));
      setTotal(r.data.total || 0);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Could not load your search history.');
    } finally { setBusy(false); }
  }, [kind, term]);

  // reloadKey changes every time the panel finishes a live search, so the list
  // already holds it when the agent switches over.
  useEffect(() => { load(0); }, [load, reloadKey]);

  const filters = [
    { key: '', label: 'All' },
    { key: 'people', label: 'People' },
    { key: 'vehicles', label: 'Vehicles' },
    ...(access?.vin ? [{ key: 'vin', label: 'VIN' }] : []),
  ];

  return (
    <div className="space-y-3">
      <Panel pad="md" radius="xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <SectionHeader level="sub" icon={History} title="Your searches"
            subtitle="Open one again without spending a search — the result is the one you were shown." />
          <Button variant="secondary" size="sm" onClick={() => load(0)} disabled={busy}>
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--color-text-tertiary)' }} />
          <input className="input pl-9 pr-9" value={text} autoComplete="off"
            placeholder="Search your history — a number, a name, a city, a car, a VIN"
            onChange={e => setText(e.target.value)} />
          {text && (
            <button type="button" onClick={() => setText('')} title="Clear"
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-text-tertiary)' }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-3"><PillTabs items={filters} value={kind} onChange={setKind} /></div>
      </Panel>

      {err && <Alert type="error" dismissible={false}>{err}</Alert>}

      {busy && !rows.length ? (
        <Loading variant="rows" rows={4} label="Loading your searches" />
      ) : !rows.length ? (
        term || kind ? (
          <EmptyState icon={Search} title="Nothing in your history matches that"
            hint={term
              ? `No search of yours mentions "${term}" — not in the number you typed, and not in what came back.`
              : 'No searches of that kind yet. Clear the filter to see everything.'} />
        ) : (
          <EmptyState icon={Search} title="No searches yet"
            hint="Everything you look up here is kept for you, so you can come back to it." />
        )
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <HistoryRow key={row.id} row={row} onOpen={onOpen} opening={openingId === row.id} />
          ))}
          {rows.length < total && (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" size="sm" onClick={() => load(rows.length)} disabled={busy}>
                Load {Math.min(PAGE, total - rows.length)} more
              </Button>
            </div>
          )}
          <p className="text-[11px] text-center m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            {rows.length} of {total} shown &middot; results are kept for 30 days, the record of the search for 6 months
          </p>
        </div>
      )}
    </div>
  );
}

// One row: when, what was typed, and what came back. The result line is the
// point of the list — a page of "People · (772) 475-7074" tells nobody which
// search was the one they want.
function HistoryRow({ row, onOpen, opening }) {
  const reopen = canReopen(row);
  return (
    <Panel pad="sm" radius="lg" tone="inset">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="info" size="sm">{KIND_LABEL[row.kind] || row.kind}</Badge>
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{row.query}</span>
            <Badge variant={STATUS_TONE[row.status] || 'info'} size="sm">
              {STATUS_LABEL[row.status] || row.status}{row.status === 'ok' ? ` ${row.result_count}` : ''}
            </Badge>
          </div>
          <p className="text-xs mt-1 mb-0 break-words" style={{ color: 'var(--color-text-secondary)' }}>
            {summaryText(row)}
          </p>
          <p className="text-[11px] mt-1 mb-0" style={{ color: 'var(--color-text-tertiary)' }}>
            <span title={exactText(row.created_at)}>{whenText(row.created_at)}</span>
            {row.ms ? ` · took ${msText(row.ms)}` : ''}
            {row.params?.mode && row.params.mode !== 'auto' ? ` · ${row.params.mode}` : ''}
          </p>
        </div>
        <div className="flex-shrink-0">
          {reopen ? (
            <Button variant="secondary" size="sm" onClick={() => onOpen(row)} disabled={opening}>
              <ExternalLink size={13} /> {opening ? 'Opening…' : 'Open'}
            </Button>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {row.status === 'pending' ? 'Never finished' : row.status === 'error' ? 'Nothing saved' : 'Result expired'}
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}
