// ============================================================================
// DayPerformancePanel — review one day's figures and finalise them.
//
// Opens from a calendar date. Shows the LIVE numbers for whatever the caller
// owns (an operations manager sees the project plus every team; a team lead
// sees only their own team) and, where a day is already finalised, the FROZEN
// snapshot beside them.
//
// The frozen-vs-live comparison is the point. Locking does not stop anyone
// editing a sale afterwards — a late correction is legitimate — so a finalised
// day can move. Showing both makes that visible instead of silent: "signed off
// at 4 approved, now reads 5" is exactly what a manager needs to see.
//
// Only an operations manager / company admin can reopen a finalised day. A team
// lead can finalise their own team but not undo it, because a finalise the lead
// can undo alone is not a finalise. The server enforces both; this only decides
// which buttons are worth offering.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { X, Lock, Unlock, ShieldCheck, AlertTriangle, Send, CheckCircle2, XCircle, Percent, Users } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { Panel, SectionHeader, KpiTile, Loading, EmptyState, accent } from '../UI/kit';
import { pct1 } from '../../utils/recordFormat';

const num = (v) => Number(v || 0).toLocaleString();

// Built in UTC from the bare date parts and rendered in UTC, so a
// 'YYYY-MM-DD' never shifts a day for a viewer west of the date line.
const dayLabel = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
};
const stamp = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

// A frozen figure next to its live one. Silent when they agree, explicit when
// they do not — a day that moved after sign-off should be impossible to miss.
function Frozen({ label, frozen, live, icon: Icon, tone }) {
  const moved = typeof live === 'number' && typeof frozen === 'number' && live !== frozen;
  return (
    <KpiTile
      icon={Icon}
      tone={moved ? 'warn' : tone}
      label={label}
      value={num(frozen)}
      sub={moved ? `now reads ${num(live)}` : 'unchanged'}
    />
  );
}

export default function DayPerformancePanel({ date, onClose, onChanged }) {
  const [data, setData]    = useState(null);
  const [loading, setLoad] = useState(true);
  const [err, setErr]      = useState('');
  const [busy, setBusy]    = useState(null);   // 'company' | teamId | 'unlock:<id>'

  const load = useCallback(async () => {
    setLoad(true); setErr('');
    try {
      const r = await client.get('daily-performance/day', { params: { date } });
      setData(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load this day');
    } finally { setLoad(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const lockOf = (scope, teamId = null) =>
    (data?.locks || []).find(l => l.scope === scope && (scope === 'team' ? l.team_id === teamId : true)) || null;

  const doLock = async (scope, teamId) => {
    setBusy(scope === 'company' ? 'company' : teamId);
    try {
      await client.post('daily-performance/lock', { date, scope, team_id: teamId || undefined });
      toast.success(scope === 'company' ? 'Project day finalised' : 'Team day finalised');
      await load(); onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not finalise this day');
    } finally { setBusy(null); }
  };

  const doUnlock = async (id) => {
    setBusy(`unlock:${id}`);
    try {
      await client.post('daily-performance/unlock', { id });
      toast.success('Day reopened');
      await load(); onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not reopen this day');
    } finally { setBusy(null); }
  };

  const companyLock = lockOf('company');
  const live = data?.company;

  return (
    <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}
      onClick={onClose}>
      <div className="w-full max-w-3xl my-auto" onClick={e => e.stopPropagation()}>
        <Panel pad="lg">
          <SectionHeader
            level="page"
            icon={ShieldCheck}
            title={dayLabel(date)}
            subtitle="Review the day's figures and finalise them. Finalising freezes these numbers; the records themselves stay editable."
            actions={
              <button onClick={onClose} title="Close"
                className="p-2 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <X size={16} />
              </button>
            }
          />

          {loading ? <Loading variant="cards" cards={4} />
            : err ? <EmptyState compact icon={AlertTriangle} title="Couldn't load this day" hint={err} />
            : (
              <div className="space-y-5">
                {!data.lockable && (
                  <p className="m-0 text-xs rounded-xl px-3 py-2"
                    style={{ background: accent('warn').soft, color: accent('warn').fg }}>
                    This day isn&apos;t over yet, so its figures are still moving. A day can be finalised once it has ended.
                  </p>
                )}

                {/* ── The project day ── */}
                {data.can_lock_company && live && (
                  <div>
                    <SectionHeader
                      level="sub"
                      icon={ShieldCheck}
                      title={companyLock ? 'Whole project · finalised' : 'Whole project'}
                      actions={
                        companyLock ? (
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                              by {companyLock.locked_by_name} · {stamp(companyLock.locked_at)}
                            </span>
                            {data.can_unlock && (
                              <button onClick={() => doUnlock(companyLock.id)} disabled={busy === `unlock:${companyLock.id}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border disabled:opacity-50"
                                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                                <Unlock size={12} /> Reopen
                              </button>
                            )}
                          </span>
                        ) : (
                          <button onClick={() => doLock('company', null)} disabled={!data.lockable || busy === 'company'}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                            style={{ background: 'var(--gradient-sidebar)' }}>
                            <Lock size={13} /> {busy === 'company' ? 'Finalising…' : 'Finalise this day'}
                          </button>
                        )
                      }
                    />
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                      {companyLock ? (
                        <>
                          <Frozen label="Call transfers"  icon={Send}         tone="info"    frozen={companyLock.stats?.transfers} live={live.transfers} />
                          <Frozen label="Approved sales"  icon={CheckCircle2} tone="success" frozen={companyLock.stats?.approved}  live={live.approved} />
                          <Frozen label="Cancelled"       icon={XCircle}      tone="danger"  frozen={companyLock.stats?.cancelled} live={live.cancelled} />
                          <Frozen label="Awaiting review" icon={ShieldCheck}  tone="warn"    frozen={companyLock.stats?.pending}   live={live.pending} />
                          <KpiTile icon={Percent} tone="muted" label="Conversion"
                            value={pct1(companyLock.stats?.conversion)} sub="frozen at sign-off" />
                        </>
                      ) : (
                        <>
                          <KpiTile icon={Send}         tone="info"    label="Call transfers"  value={num(live.transfers)} />
                          <KpiTile icon={CheckCircle2} tone="success" label="Approved sales"  value={num(live.approved)} />
                          <KpiTile icon={XCircle}      tone="danger"  label="Cancelled"       value={num(live.cancelled)} />
                          <KpiTile icon={ShieldCheck}  tone="warn"    label="Awaiting review" value={num(live.pending)} />
                          <KpiTile icon={Percent}      tone="muted"   label="Conversion"      value={pct1(live.conversion)}
                            sub={`${num(live.sales)} of ${num(live.transfers)}`} />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Per team ── */}
                {data.teams?.length > 0 && (
                  <div>
                    <SectionHeader level="sub" icon={Users}
                      title={data.can_lock_company ? 'By team' : 'Your team'} />
                    <div className="space-y-2">
                      {data.teams.map(t => {
                        const tl = lockOf('team', t.team_id);
                        const s = tl ? tl.stats : t;
                        return (
                          <Panel key={t.team_id} tone="inset" radius="xl" pad="sm">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: t.color || 'var(--color-primary-600)' }} />
                                <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{t.name}</span>
                                <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                                  {t.members} member{t.members === 1 ? '' : 's'}
                                </span>
                                {tl && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                                    style={{ color: accent('success').fg, background: accent('success').soft }}>
                                    <Lock size={10} /> finalised
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-3 flex-wrap text-xs tabular-nums">
                                <span style={{ color: accent('info').fg }}>{num(s.transfers)} transfers</span>
                                <span style={{ color: accent('success').fg }}>{num(s.approved)} approved</span>
                                <span style={{ color: accent('danger').fg }}>{num(s.cancelled)} cancelled</span>
                                <span style={{ color: 'var(--color-text-secondary)' }}>{pct1(s.conversion)}</span>
                                {tl ? (
                                  data.can_unlock && (
                                    <button onClick={() => doUnlock(tl.id)} disabled={busy === `unlock:${tl.id}`}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border disabled:opacity-50"
                                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                                      <Unlock size={11} /> Reopen
                                    </button>
                                  )
                                ) : (
                                  <button onClick={() => doLock('team', t.team_id)} disabled={!data.lockable || busy === t.team_id}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border disabled:opacity-40"
                                    style={{ borderColor: accent('primary').fg, color: accent('primary').fg, background: accent('primary').soft }}>
                                    <Lock size={11} /> {busy === t.team_id ? 'Finalising…' : 'Finalise'}
                                  </button>
                                )}
                              </span>
                            </div>
                          </Panel>
                        );
                      })}
                    </div>
                    {/* The project total legitimately exceeds the sum of its teams:
                        anyone on no team still counts for the company. Saying so
                        stops it reading as a bug. */}
                    {data.can_lock_company && live && (
                      <p className="m-0 mt-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        Teams sum to {num(data.teams.reduce((n, t) => n + t.transfers, 0))} of {num(live.transfers)} transfers — the rest belong to people on no team.
                      </p>
                    )}
                  </div>
                )}

                {!data.can_lock_company && !data.teams?.length && (
                  <EmptyState compact icon={Users} title="Nothing to finalise"
                    hint="You don't lead a team, and finalising the whole project day is an operations manager's action." />
                )}
              </div>
            )}
        </Panel>
      </div>
    </div>
  );
}
