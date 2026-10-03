// ============================================================================
// CustomerLookupActivity — what the floor is doing with the lookup tool.
//
// Superadmin only. The tool reaches an external PII service, and until mig 337
// the only record of a search was one line in the server log — which answers
// "did it 200?" and nothing anybody actually asks. This answers those:
// who is using it, what they are typing, and what came back.
//
// It reads the same rows the agent's own History reads, so the result shown
// here IS the result that agent was shown. Opening one is free and runs
// nothing — see CustomerLookupHistory for why that matters.
// ============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, RefreshCw, Users2, ExternalLink, Search, X } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, EmptyState, KpiTile, Loading, TableScroll } from '../UI/kit';
import { Badge, Button, Alert } from '../UI';
import ThemedSelect from '../UI/Select';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import {
  KIND_LABEL, STATUS_TONE, STATUS_LABEL,
  whenText, exactText, summaryText, canReopen, msText,
} from '../../utils/lookupHistory';

const PAGE = 50;
const KINDS = ['people', 'search', 'addresses', 'vehicles', 'vin', 'enrich'];

// A date range is inclusive of its last day, and `to` compares against a
// timestamp — so the end has to be the end OF that day, or every search made
// after midnight this morning disappears from "today".
const endOfDay   = (d) => (d ? `${d}T23:59:59.999Z` : undefined);
const startOfDay = (d) => (d ? `${d}T00:00:00.000Z` : undefined);

export default function CustomerLookupActivity({ onOpen, openingId }) {
  const [range, setRange] = useState(() => getPresetRange('7d'));
  const [kind, setKind]   = useState('');
  const [user, setUser]   = useState('');
  const [text, setText]   = useState('');
  const [applied, setApplied] = useState('');     // the text actually searched

  const [rows, setRows]   = useState([]);
  const [names, setNames] = useState({});
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [busy, setBusy]   = useState(true);
  const [err, setErr]     = useState('');

  const params = useMemo(() => ({
    from: startOfDay(range.date_from),
    to: endOfDay(range.date_to),
    kind: kind || undefined,
    user_id: user || undefined,
    q: applied || undefined,
  }), [range, kind, user, applied]);

  const load = useCallback(async (offset = 0) => {
    setBusy(true); setErr('');
    try {
      // The ladder and the list are one screen, so they load together — but
      // the ladder ignores the user filter, because its job is to show who
      // ELSE is using the tool.
      const [list, who] = await Promise.all([
        client.get('customer-lookup/history/all', { params: { ...params, limit: PAGE, offset } }),
        offset === 0
          ? client.get('customer-lookup/history/users', { params: { from: params.from, to: params.to } })
          : Promise.resolve(null),
      ]);
      setRows(prev => (offset ? [...prev, ...(list.data.rows || [])] : (list.data.rows || [])));
      setTotal(list.data.total || 0);
      setNames(prev => ({ ...prev, ...(list.data.names || {}), ...(who?.data?.names || {}) }));
      if (who) setStats(who.data);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Could not load the lookup activity.');
    } finally { setBusy(false); }
  }, [params]);

  useEffect(() => { load(0); }, [load]);

  const t = stats?.totals || {};

  return (
    <div className="space-y-3">
      <Panel pad="md" radius="xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <SectionHeader level="sub" icon={Activity} title="Agent activity"
            subtitle="Every search run with this tool, by anyone — what they typed and what came back." />
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker
              value={range}
              defaultPreset="7d"
              onChange={(r) => setRange({ date_from: r.date_from || '', date_to: r.date_to || '' })}
              onClear={() => setRange({ date_from: '', date_to: '' })} />
            <Button variant="secondary" size="sm" onClick={() => load(0)} disabled={busy}>
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <ThemedSelect value={kind} onChange={e => setKind(e.target.value)} className="input text-xs py-1.5">
            <option value="">Every kind of search</option>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </ThemedSelect>
          <ThemedSelect value={user} onChange={e => setUser(e.target.value)} className="input text-xs py-1.5">
            <option value="">Everyone</option>
            {(stats?.users || []).map(u => (
              <option key={u.user_id} value={u.user_id}>
                {names[u.user_id] || u.user_id} ({u.searches})
              </option>
            ))}
          </ThemedSelect>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--color-text-tertiary)' }} />
            <input className="input pl-8 pr-8 text-xs py-1.5" value={text} placeholder="A number or a name that was searched"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setApplied(text.trim()); }} />
            {(text || applied) && (
              <button type="button" onClick={() => { setText(''); setApplied(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }}>
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        {text.trim() && text.trim() !== applied && (
          <p className="text-[11px] mt-2 mb-0" style={{ color: 'var(--color-text-tertiary)' }}>
            Press Enter to search for &ldquo;{text.trim()}&rdquo;.
          </p>
        )}
      </Panel>

      {err && <Alert type="error" dismissible={false}>{err}</Alert>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile icon={Search} label="Searches" value={(t.searches || 0).toLocaleString()} tone="primary"
            sub={stats.users.length === 1 ? '1 agent' : `${stats.users.length} agents`} />
          <KpiTile icon={Users2} label="Found something" value={(t.found || 0).toLocaleString()} tone="success" />
          <KpiTile label="Came back empty" value={(t.empty || 0).toLocaleString()} tone="muted" />
          <KpiTile label="Failed" value={(t.errors || 0).toLocaleString()} tone={t.errors ? 'danger' : 'muted'}
            sub={t.pending ? `${t.pending} never finished` : undefined} />
        </div>
      )}

      {stats?.capped && (
        <Alert type="info" dismissible={false}>
          This window holds more searches than the summary counts (5,000). Narrow the dates for exact totals —
          the list below is unaffected.
        </Alert>
      )}

      {/* ── who is using it ─────────────────────────────────────────────────── */}
      {!!stats?.users?.length && (
        <Panel pad="md" radius="xl">
          <SectionHeader level="sub" icon={Users2} title="Who is using it"
            subtitle="Click a name to see only their searches." />
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-tertiary)' }}>
                  <th className="text-left font-semibold py-1.5">Agent</th>
                  <th className="text-right font-semibold py-1.5">Searches</th>
                  <th className="text-right font-semibold py-1.5">Found</th>
                  <th className="text-left font-semibold py-1.5 pl-4">What they searched</th>
                  <th className="text-right font-semibold py-1.5">Last</th>
                </tr>
              </thead>
              <tbody>
                {stats.users.map(u => (
                  <tr key={u.user_id} className="cursor-pointer transition-colors"
                    onClick={() => setUser(user === u.user_id ? '' : u.user_id)}
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      background: user === u.user_id ? 'var(--color-surface-hover)' : 'transparent',
                    }}>
                    <td className="py-1.5 font-semibold" style={{ color: 'var(--color-text)' }}>
                      {names[u.user_id] || u.user_id}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{u.searches}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{u.found}</td>
                    <td className="py-1.5 pl-4" style={{ color: 'var(--color-text-secondary)' }}>
                      {Object.entries(u.kinds || {}).map(([k, n]) => `${KIND_LABEL[k] || k} ${n}`).join(' · ')}
                    </td>
                    <td className="py-1.5 text-right" style={{ color: 'var(--color-text-tertiary)' }} title={exactText(u.last_at)}>
                      {whenText(u.last_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {/* ── every search ────────────────────────────────────────────────────── */}
      {busy && !rows.length ? (
        <Loading variant="rows" rows={5} label="Loading searches" />
      ) : !rows.length ? (
        <EmptyState icon={Search} title="No searches in this window"
          hint="Widen the dates, or clear the filters above." />
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <Panel key={row.id} pad="sm" radius="lg" tone="inset">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                      {names[row.user_id] || row.user_id}
                    </span>
                    <Badge variant="info" size="sm">{KIND_LABEL[row.kind] || row.kind}</Badge>
                    <span className="text-sm" style={{ color: 'var(--color-text)' }}>{row.query}</span>
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
                  </p>
                </div>
                {canReopen(row) && (
                  <Button variant="secondary" size="sm" onClick={() => onOpen(row)} disabled={openingId === row.id}>
                    <ExternalLink size={13} /> {openingId === row.id ? 'Opening…' : 'See result'}
                  </Button>
                )}
              </div>
            </Panel>
          ))}
          {rows.length < total && (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" size="sm" onClick={() => load(rows.length)} disabled={busy}>
                Load {Math.min(PAGE, total - rows.length)} more
              </Button>
            </div>
          )}
          <p className="text-[11px] text-center m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            {rows.length} of {total} searches shown
          </p>
        </div>
      )}
    </div>
  );
}
