// ============================================================================
// Payroll run -> "Commission & SPIFF". What each person on the run earned in
// the pay period from commission plans and SPIFF prizes, next to what the run
// holds now -- and one button to apply the ticked rows.
//
// Pay changes only by HR's hand: nothing is applied until "Apply" is pressed,
// the server recomputes every amount (the numbers on screen are never sent
// back), and a manual adjustment typed on top of an earlier apply survives
// (utils/payrollSuggestions.js).
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Check } from 'lucide-react';
import client from '../../api/client';
import { Loading, EmptyState, TableScroll, CheckRow } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import { Btn, ModuleModal } from '../../components/Modules/ModuleUI';
import { fmtMoney, fmtDate } from '../../utils/money';

export default function PayrollSuggestions({ companyId, runId, onClose, onApplied }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [what, setWhat] = useState({ commission: true, spiff: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get(`hr/payroll/runs/${runId}/suggestions`, { params: { company_id: companyId || undefined } })
      .then(r => {
        setData(r.data);
        // Pre-tick the rows where applying would change something.
        setPicked(new Set(r.data.rows.filter(x => changes(x, { commission: true, spiff: true })).map(x => x.entry_id)));
      })
      .catch(e => setError(e.response?.data?.error || 'Could not work out the suggestions'));
  }, [companyId, runId]);

  const cur = data?.run?.currency;
  const rows = data?.rows || [];
  const withAnything = useMemo(() => rows.filter(r => r.commission.amount > 0 || r.spiff.amount > 0 || r.applied_before.commission > 0 || r.applied_before.spiff > 0 || r.commission.lines.length), [rows]);
  const toChange = rows.filter(r => picked.has(r.entry_id) && changes(r, what));

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const r = await client.post(`hr/payroll/runs/${runId}/apply-suggestions`, {
        company_id: companyId, entry_ids: [...picked], commission: what.commission, spiff: what.spiff,
      });
      onApplied?.(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not apply them');
    } finally { setBusy(false); }
  };

  return (
    <ModuleModal wide title="Commission and SPIFF for this run"
      subtitle={data ? `Sales from ${fmtDate(data.period.start_date)} to ${fmtDate(data.period.end_date)}, worked out from ${data.plans} commission plan${data.plans === 1 ? '' : 's'} and the SPIFF campaigns that ended in the period.` : undefined}
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Close</Btn>
        {data?.can_apply && (
          <Btn variant="primary" icon={Check} busy={busy} disabled={!toChange.length || (!what.commission && !what.spiff)} onClick={apply}>
            Apply to {toChange.length} {toChange.length === 1 ? 'person' : 'people'}
          </Btn>
        )}
      </>}>
      {error && <Alert type="error">{error}</Alert>}
      {!data ? (!error && <Loading variant="table" rows={5} />) : withAnything.length === 0 ? (
        <EmptyState compact icon={Sparkles} title="Nothing earned from plans or SPIFF"
          hint={data.plans ? 'Nobody on this run has counting sales in the period, and no SPIFF ended in it.' : 'There are no commission plans yet -- add one under Pay, Commission plans.'} />
      ) : (
        <div className="space-y-3">
          {data.can_apply ? (
            <div className="flex items-center gap-4 flex-wrap">
              <CheckRow checked={what.commission} onChange={v => setWhat(w => ({ ...w, commission: v }))} label="Commission" hint={`Total ${fmtMoney(data.totals.commission, cur)}`} />
              <CheckRow checked={what.spiff} onChange={v => setWhat(w => ({ ...w, spiff: v }))} label="SPIFF prizes (into Bonus)" hint={`Total ${fmtMoney(data.totals.spiff, cur)}`} />
            </div>
          ) : (
            <Alert type="info" dismissible={false}>This run is {data.run.status}; the amounts are shown for reference only.</Alert>
          )}
          <TableScroll>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['', 'Employee', 'Commission now', 'From plans', 'Bonus now', 'SPIFF'].map((h, i) => (
                    <th key={h + i} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i >= 2 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {withAnything.map(r => (
                  <tr key={r.entry_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="td-p">
                      {data.can_apply && (
                        <input type="checkbox" checked={picked.has(r.entry_id)} aria-label={`Apply for ${r.name}`}
                          onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(r.entry_id); else n.delete(r.entry_id); return n; })}
                          style={{ accentColor: 'var(--color-primary-600)', width: 15, height: 15 }} />
                      )}
                    </td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                      {r.name}
                      {r.commission.lines.map(l => (
                        <span key={l.plan_id} className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          {l.plan}: {l.note || `${l.sales} sales`}{Number(l.amount) > 0 ? ` = ${fmtMoney(l.amount, cur)}` : ''}
                        </span>
                      ))}
                      {r.spiff.lines.map(w => (
                        <span key={w.campaign_id} className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          SPIFF {w.campaign}: {w.value} of {w.target} = {fmtMoney(w.reward, cur)}
                        </span>
                      ))}
                      {r.problems.map((p, i) => (
                        <span key={i} className="block text-[11px]" style={{ color: 'var(--color-warning-600)' }}>{p}</span>
                      ))}
                    </td>
                    <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtMoney(r.current.commission, cur)}</td>
                    <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{fmtMoney(r.commission.amount, cur)}</td>
                    <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtMoney(r.current.bonus, cur)}</td>
                    <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{fmtMoney(r.spiff.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            Applying sets Commission (and Bonus, for SPIFF) to what the plans say, keeping anything typed by hand on top of an earlier apply.
            Sales from earlier periods that were reverted later are not taken back automatically -- add a deduction if needed.
          </p>
        </div>
      )}
    </ModuleModal>
  );
}

// Would applying change this row's numbers?
function changes(r, what) {
  const c = what.commission && Math.round((r.commission.amount - r.applied_before.commission) * 100) !== 0;
  const s = what.spiff && Math.round((r.spiff.amount - r.applied_before.spiff) * 100) !== 0;
  return c || s;
}
