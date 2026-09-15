// ============================================================================
// IpAccessLog -- "Access attempts": every blocked request or login, and every
// allowed login, filterable by user, result, event, address and date range.
// Opens on blocked attempts, newest first -- the question an admin arrives with
// is almost always "who just got locked out?".
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';
import ThemedDate from '../../UI/ThemedDate';
import { Loading, EmptyState, TableScroll, Field, IconButton } from '../../UI/kit';
import { ResultPill, Callout, fmtWhen } from './IpAccessShared';

const LIMIT = 50;
// Local-day bounds, so "the 14th" means the admin's 14th, not UTC's.
const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export default function IpAccessLog({ users = [], onOpenUser }) {
  const [filters, setFilters] = useState({ user_id: '', result: 'blocked', event: '', ip: '', from: '', to: '' });
  const [ipDraft, setIpDraft] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const { user_id, result, event, ip, from, to } = filters;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('ip-access/logs', {
        params: {
          user_id: user_id || undefined, result: result || undefined, event: event || undefined,
          ip: ip || undefined, from: dayStart(from), to: dayEnd(to), page, limit: LIMIT,
        },
      });
      setData(r.data);
      setErr(null);
    } catch (e) { setErr(e.response?.data?.error || 'Could not load the access log.'); }
    finally { setLoading(false); }
  }, [user_id, result, event, ip, from, to, page]);

  useEffect(() => { load(); }, [load]);

  // The address box filters on Enter / blur, not on every keystroke.
  useEffect(() => { setIpDraft(ip); }, [ip]);
  const set = (k) => (e) => { setPage(1); setFilters(f => ({ ...f, [k]: e.target.value })); };
  const applyIp = () => { if (ipDraft.trim() !== ip) { setPage(1); setFilters(f => ({ ...f, ip: ipDraft.trim() })); } };

  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 items-end">
        <Field label="User" className="lg:col-span-2">
          <ThemedSelect value={user_id} onChange={set('user_id')} className="input w-full">
            <option value="">Everyone</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Result">
          <ThemedSelect value={result} onChange={set('result')} className="input w-full">
            <option value="blocked">Blocked</option>
            <option value="allowed">Allowed</option>
            <option value="">All</option>
          </ThemedSelect>
        </Field>
        <Field label="Event">
          <ThemedSelect value={event} onChange={set('event')} className="input w-full">
            <option value="">Any</option>
            <option value="login">Login</option>
            <option value="request">During a session</option>
            <option value="refresh">Session renewal</option>
            <option value="exchange">Magic link</option>
          </ThemedSelect>
        </Field>
        <Field label="From"><ThemedDate value={from} onChange={set('from')} max={to || undefined} className="input w-full" /></Field>
        <Field label="To"><ThemedDate value={to} onChange={set('to')} min={from || undefined} className="input w-full" /></Field>
        <Field label="Address" className="sm:col-span-2 lg:col-span-5">
          <input value={ipDraft} onChange={e => setIpDraft(e.target.value)} onBlur={applyIp}
            onKeyDown={e => { if (e.key === 'Enter') applyIp(); }}
            placeholder="Exact address, or part of one (e.g. 203.0.113.)" className="input w-full font-mono" spellCheck={false} />
        </Field>
        <div className="flex items-center gap-2 justify-end">
          <IconButton label="Refresh" onClick={load}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></IconButton>
        </div>
      </div>

      {err && <Callout tone="danger">{err}</Callout>}
      {!data && !err && <Loading variant="rows" rows={6} label="Loading access attempts…" />}

      {data && (data.logs.length === 0 ? (
        <EmptyState title="No matching attempts"
          hint={result === 'blocked' ? 'Nobody has been blocked for these filters. Attempts are recorded only while IP restriction is on.' : 'Nothing recorded for these filters.'} />
      ) : (
        <>
          <TableScroll label="Access attempts">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: 'var(--color-text-secondary)' }}>
                  <th className="text-left font-semibold py-2 pr-3">When</th>
                  <th className="text-left font-semibold py-2 pr-3">User</th>
                  <th className="text-left font-semibold py-2 pr-3">Address</th>
                  <th className="text-left font-semibold py-2 pr-3">Result</th>
                  <th className="text-left font-semibold py-2 pr-3">Event</th>
                  <th className="text-left font-semibold py-2 pr-3">Reason</th>
                  <th className="text-left font-semibold py-2">Where / device</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(l => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtWhen(l.created_at)}</td>
                    <td className="py-2 pr-3 min-w-[140px]">
                      {l.user_id && onOpenUser ? (
                        <button type="button" onClick={() => onOpenUser(l.user_id)} className="text-left hover:underline"
                          style={{ color: 'var(--color-primary-600)' }}>
                          {l.user_name || l.user_email || l.user_id}
                        </button>
                      ) : (l.user_name || l.user_email || '—')}
                    </td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{l.ip_address || '—'}</td>
                    <td className="py-2 pr-3"><ResultPill result={l.result} /></td>
                    <td className="py-2 pr-3 whitespace-nowrap">{l.event}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--color-text-secondary)' }}>{l.reason || '—'}</td>
                    <td className="py-2 text-[12px] max-w-[280px] truncate" style={{ color: 'var(--color-text-tertiary)' }}
                      title={[l.path, l.user_agent].filter(Boolean).join('\n')}>
                      {l.path || ''}{l.user_agent ? ` · ${l.user_agent}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <div className="flex items-center justify-between gap-2 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{total.toLocaleString()} attempt{total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={15} /></IconButton>
              <span>Page {page} of {pages}</span>
              <IconButton label="Next page" disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}><ChevronRight size={15} /></IconButton>
            </div>
          </div>
        </>
      ))}
    </div>
  );
}
