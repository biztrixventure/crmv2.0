// ============================================================================
// PolicyScreen -- one policy, the way the support desk's old policy program
// drew it: Contact / Vehicle / Campaign boxes, a grid of boxed read-only
// fields, then a tab control (Details, Calls, Payments, Policies, History,
// Retention).
//
// Used twice: by the support agent (who can log calls, mark the customer
// saved / not saved and send the case to compliance) and by compliance /
// superadmin from the Support reports (mode="review": the same screen, with
// Approve / Send Back instead). One screen, so the reviewer sees exactly what
// the agent saw.
//
// Every rule is enforced by the server (routes/support.js); `work` from the
// API says whether THIS person may log a call, so the buttons never have to
// re-derive it.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, ChevronLeft, ChevronRight, PhoneCall, CheckCircle2, XCircle, Send, RotateCcw,
  RefreshCw, IdCard, Car, ThumbsUp, Undo2,
} from 'lucide-react';
import client from '../../api/client';
import SxDialog from './SxDialog';
import {
  money, day, dateTime, num, saleStatus, caseStatus, pretty, vehicle, localInputToIso, errText,
} from './supportFormat';

const Fld = ({ label, value, cls = '', span = '' }) => (
  <div className={`sx-fld ${span}`}>
    <span className="sx-lbl">{label}:</span>
    <div className={`sx-val ${cls}`} title={typeof value === 'string' ? value : undefined}>{value || ' '}</div>
  </div>
);

export default function PolicyScreen({
  saleId, position, onPrev, onNext, onBack, onOpenSale, onChanged,
  outcomes = [], mode = 'work',
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('details');
  const [dialog, setDialog] = useState(null);      // 'call' | 'saved' | 'lost' | 'approve' | 'return'
  const [busy, setBusy] = useState(false);
  const [dlgError, setDlgError] = useState('');
  const [flash, setFlash] = useState('');
  const [form, setForm] = useState({ outcome: '', notes: '', follow: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await client.get(`support/policies/${saleId}`);
      setData(res.data);
    } catch (e) {
      setData(null);
      setError(errText(e, 'Could not open this policy.'));
    } finally { setLoading(false); }
  }, [saleId]);

  useEffect(() => { setTab('details'); setFlash(''); load(); }, [load]);

  const open = (kind) => {
    setForm({ outcome: '', notes: '', follow: '', reason: '' });
    setDlgError(''); setDialog(kind);
  };
  const close = () => { if (!busy) setDialog(null); };

  // Run one write, then re-read the policy so the screen is what the server has.
  const run = async (fn, okText) => {
    setBusy(true); setDlgError('');
    try {
      await fn();
      setDialog(null);
      setFlash(okText);
      await load();
      onChanged?.();
    } catch (e) {
      setDlgError(errText(e, 'That did not save. Try again.'));
    } finally { setBusy(false); }
  };

  if (loading && !data) return <div className="sx-empty">Opening policy...</div>;
  if (error) {
    return (
      <div className="sx-body">
        <div className="sx-note bad">{error}</div>
        <button type="button" className="sx-btn" onClick={onBack}><ArrowLeft size={14} /> Back to list</button>
      </div>
    );
  }
  if (!data) return null;

  const p = data.policy;
  const c = data.case;
  const f = p.form || {};
  const st = saleStatus(p.status);
  const cs = c ? caseStatus(c.status) : null;
  const isWork = mode === 'work';
  const mine = !!c && data.work?.can;
  const canLog = isWork && data.work?.can;
  const canMark = isWork && mine && ['open', 'saved', 'returned'].includes(c?.status);
  const canSend = isWork && mine && c?.status === 'saved';
  const canReview = mode === 'review' && c?.status === 'pending_approval';
  const cityLine = [f.City, [f.State, f.Zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const address = p.customer_address || f.Address || '';

  const submitCall = () => run(
    () => client.post(`support/policies/${p.id}/calls`, {
      outcome: form.outcome, notes: form.notes, follow_up_at: localInputToIso(form.follow),
    }),
    'Call logged.',
  );

  const TABS = [
    ['details', 'Details'],
    ['calls', `Calls (${data.calls.length})`],
    ['payments', 'Payments'],
    ['policies', `Policies (${data.other_policies.length})`],
    ['history', 'History'],
    ['retention', `Retention (${data.cases.length})`],
  ];

  return (
    <>
      <div className="sx-toolbar">
        <button type="button" className="sx-tool" onClick={onBack}><ArrowLeft size={15} /> List</button>
        <span className="sx-tool-sep" />
        {position && (
          <>
            <span className="sx-pos">Policy {position.index + 1} of {position.total}</span>
            <button type="button" className="sx-tool" onClick={onPrev} disabled={!onPrev} aria-label="Previous policy"><ChevronLeft size={16} /></button>
            <button type="button" className="sx-tool" onClick={onNext} disabled={!onNext} aria-label="Next policy"><ChevronRight size={16} /></button>
            <span className="sx-tool-sep" />
          </>
        )}
        {isWork && (
          <>
            <button type="button" className="sx-tool" onClick={() => open('call')} disabled={!canLog}><PhoneCall size={15} /> Log Call</button>
            <button type="button" className="sx-tool" onClick={() => open('saved')} disabled={!canMark || c?.status === 'saved'}><CheckCircle2 size={15} /> Customer Saved</button>
            <button type="button" className="sx-tool" onClick={() => open('lost')} disabled={!canMark}><XCircle size={15} /> Not Saved</button>
            <button type="button" className="sx-tool" onClick={() => open('send')} disabled={!canSend}><Send size={15} /> Send to Compliance</button>
            {mine && c?.status === 'saved' && (
              <button type="button" className="sx-tool" disabled={busy}
                onClick={() => run(() => client.post(`support/cases/${c.id}/status`, { status: 'open' }), 'Case reopened.')}>
                <RotateCcw size={15} /> Reopen
              </button>
            )}
          </>
        )}
        {mode === 'review' && (
          <>
            <button type="button" className="sx-tool" onClick={() => open('approve')} disabled={!canReview}><ThumbsUp size={15} /> Approve</button>
            <button type="button" className="sx-tool" onClick={() => open('return')} disabled={!canReview}><Undo2 size={15} /> Send Back</button>
          </>
        )}
        <span className="sx-spacer" />
        <button type="button" className="sx-tool" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
      </div>

      <div className="sx-body">
        {flash && <div className="sx-note good" role="status">{flash}</div>}
        {isWork && data.work?.reason === 'other_agent' && (
          <div className="sx-note">This customer is being worked by {data.work.held_by}. You can read the policy but not log calls on it.</div>
        )}
        {isWork && data.work?.reason === 'with_compliance' && (
          <div className="sx-note">This case is with compliance for final approval. Nothing more to do until they decide.</div>
        )}
        {c?.status === 'returned' && c.review_note && (
          <div className="sx-note bad"><b>Sent back by compliance{c.reviewer_name ? ` (${c.reviewer_name})` : ''}:</b> {c.review_note}</div>
        )}

        <div className="sx-groups">
          <fieldset className="sx-group">
            <legend>Contact</legend>
            <div className="sx-group-row">
              <IdCard className="sx-group-ico" size={20} />
              <div className="sx-group-lines">
                <div><b>{p.customer_name || 'No name on file'}</b></div>
                {address && <div>{address}</div>}
                {cityLine && <div>{cityLine}</div>}
                {p.customer_phone && <div><a className="sx-link" href={`tel:${p.customer_phone}`}>{p.customer_phone}</a></div>}
                {p.customer_phone_2 && <div><a className="sx-link" href={`tel:${p.customer_phone_2}`}>{p.customer_phone_2}</a> (2nd)</div>}
                {(p.customer_email || f.Email) && <div>{p.customer_email || f.Email}</div>}
              </div>
            </div>
          </fieldset>
          <fieldset className="sx-group">
            <legend>Vehicle</legend>
            <div className="sx-group-row">
              <Car className="sx-group-ico car" size={20} />
              <div className="sx-group-lines">
                <div><b>{vehicle(p) || 'No vehicle on file'}</b></div>
                {(p.car_miles || f.Miles) && <div>{num(p.car_miles) || f.Miles} Miles</div>}
                {p.car_vin && <div>VIN: {p.car_vin}</div>}
                {f.Variant && <div>{f.Variant}</div>}
              </div>
            </div>
          </fieldset>
          <fieldset className="sx-group">
            <legend>Campaign</legend>
            <div className="sx-group-lines">
              <div><b>{p.client_name || 'No client'}</b></div>
              <div>Sold {day(p.sale_date)}</div>
              <div>{[p.company_name, p.reference_no].filter(Boolean).join(' - ')}</div>
            </div>
          </fieldset>
        </div>

        <div className="sx-form">
          <Fld label="Status" value={st.label} cls={`st-${st.tone}`} />
          <Fld label="Effective Date" value={day(p.sale_date)} />
          <Fld label="User" value={p.closer_name} />

          <Fld label="Policy Number" value={p.policy_number || p.reference_no} />
          <Fld label="Down Pmt Amount" value={money(p.down_payment)} cls="money" />
          <Fld label="Fronter" value={p.fronter_name} />

          <Fld label="Coverage" value={p.plan} />
          <Fld label="Monthly Payment" value={money(p.monthly_payment)} cls="money" />
          <Fld label="Client" value={p.client_name} />

          <Fld label="Term Months" value={f.PlanDuration} />
          <Fld label="Payment Duration" value={f.Payment_Duration} />
          <Fld label="Monthly Date" value={day(f.Monthly_Date) || f.Monthly_Date} />

          <Fld label="Vehicle Odometer" value={num(p.car_miles) || f.Miles} />
          <Fld label="State" value={f.State} />
          <Fld label="Company" value={p.company_name} />

          <Fld label="Cancel Date" value={day(p.cancellation_date)} />
          <Fld label="Cancel Reason" value={pretty(p.cancellation_reason_key)} />
          <Fld label="Retention" value={cs ? `${cs.label}${c.agent_name ? ` - ${c.agent_name}` : ''}` : 'Not started'} />
        </div>

        <div className="sx-subtabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="sx-subtab" onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        <div className="sx-pane" role="tabpanel">
          {tab === 'details' && (
            <div className="sx-form">
              <Fld label="Type" value="Vehicle Service Contract" />
              <Fld label="Sold By" value={p.closer_name} />
              <Fld label="Second User" value={f['2nd_user']} />

              <Fld label="Premium" value={money(p.down_payment)} cls="money" />
              <Fld label="Disposition" value={p.closer_disposition} />
              <Fld label="Resell" value={p.is_resell ? 'Yes' : 'No'} />

              <Fld label="Date Sold" value={dateTime(p.created_at)} />
              <Fld label="Vehicle Condition" value={f.Condition} />
              <Fld label="Customer Age" value={f.Age} />

              <Fld label="VIN" value={p.car_vin} />
              <Fld label="Email" value={p.customer_email || f.Email} />
              <Fld label="Other Contact" value={f.Other_Contact} />

              <Fld label="Reinstate Date" value={dateTime(p.reinstated_at)} />
              <Fld label="Reinstated By" value={p.reinstated_by_name} />
              <Fld label="Last Updated" value={dateTime(p.updated_at)} />

              <Fld label="Reinstate Reason" value={p.reinstate_reason} cls="wrap" span="span3" />
              {p.compliance_note && <Fld label="Compliance Note" value={p.compliance_note} cls="wrap" span="span3" />}
            </div>
          )}

          {tab === 'calls' && (
            data.calls.length === 0
              ? <div className="sx-empty">No calls logged on this policy yet.{canLog ? ' Use Log Call after you speak to the customer.' : ''}</div>
              : (
                <div className="sx-gridwrap">
                  <table className="sx-grid">
                    <thead><tr><th>Date / Time (ET)</th><th>Agent</th><th>Outcome</th><th>What happened</th><th>Follow-up</th></tr></thead>
                    <tbody>
                      {data.calls.map((k) => (
                        <tr key={k.id}>
                          <td className="nowrap">{dateTime(k.called_at)}</td>
                          <td className="nowrap">{k.agent_name}</td>
                          <td className="nowrap">{outcomes.find((o) => o.key === k.outcome)?.label || pretty(k.outcome)}</td>
                          <td className="story">{k.notes}</td>
                          <td className="nowrap">{dateTime(k.follow_up_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {tab === 'payments' && (
            <div className="sx-form">
              <Fld label="Down Payment" value={money(p.down_payment)} cls="money" />
              <Fld label="Monthly Payment" value={money(p.monthly_payment)} cls="money" />
              <Fld label="Monthly Date" value={day(f.Monthly_Date) || f.Monthly_Date} />
              <Fld label="Payment Duration" value={f.Payment_Duration} />
              <Fld label="Term Months" value={f.PlanDuration} />
              <Fld label="Chargeback Date" value={day(p.chargeback_date)} />
              <Fld label="Chargeback Amt" value={money(p.chargeback_amount)} cls="money" />
              <Fld label="Payment Note" value={p.payment_due_note} cls="wrap" span="span2" />
            </div>
          )}

          {tab === 'policies' && (
            <div className="sx-gridwrap">
              <table className="sx-grid">
                <thead><tr><th>Policy</th><th>Client</th><th className="num">Down Pmt</th><th className="num">Monthly</th><th>Effective Date</th><th>Cancel Date</th><th>Policy Number</th><th>Status</th></tr></thead>
                <tbody>
                  {data.other_policies.map((o) => {
                    const os = saleStatus(o.status);
                    const here = o.id === p.id;
                    return (
                      <tr key={o.id} className={here ? 'on' : ''}>
                        <td>
                          {here || !onOpenSale
                            ? `${o.plan || 'Policy'} - ${vehicle(o)}`
                            : <button type="button" className="sx-link" onClick={() => onOpenSale(o.id)}>{o.plan || 'Policy'} - {vehicle(o)}</button>}
                        </td>
                        <td className="nowrap">{o.client_name}</td>
                        <td className="num">{money(o.down_payment)}</td>
                        <td className="num">{money(o.monthly_payment)}</td>
                        <td className="nowrap">{day(o.sale_date)}</td>
                        <td className="nowrap">{day(o.cancellation_date)}</td>
                        <td className="nowrap">{o.policy_number || o.reference_no}</td>
                        <td className="nowrap">{os.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'history' && (
            data.history.length === 0
              ? <div className="sx-empty">No history recorded for this policy.</div>
              : (
                <div className="sx-gridwrap">
                  <table className="sx-grid">
                    <thead><tr><th>Date / Time (ET)</th><th>Event</th><th>By</th><th>Note</th></tr></thead>
                    <tbody>
                      {data.history.map((h) => (
                        <tr key={h.id}>
                          <td className="nowrap">{dateTime(h.at)}</td>
                          <td className="nowrap">{pretty(h.event_type)}</td>
                          <td className="nowrap">{h.actor_name}</td>
                          <td className="story">{h.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {tab === 'retention' && (
            data.cases.length === 0
              ? <div className="sx-empty">Nobody has worked this customer yet.</div>
              : (
                <div className="sx-gridwrap">
                  <table className="sx-grid">
                    <thead><tr><th>Opened</th><th>Agent</th><th>Status</th><th className="num">Calls</th><th>How it was saved / why not</th><th>Compliance</th></tr></thead>
                    <tbody>
                      {data.cases.map((k) => {
                        const ks = caseStatus(k.status);
                        return (
                          <tr key={k.id}>
                            <td className="nowrap">{dateTime(k.created_at)}</td>
                            <td className="nowrap">{k.agent_name}</td>
                            <td className="nowrap"><span className={`sx-pill ${ks.pill}`}>{ks.label}</span></td>
                            <td className="num">{k.call_count}</td>
                            <td className="story">{k.save_reason || k.lost_reason}</td>
                            <td className="story">
                              {k.reviewed_at && `${k.reviewer_name || 'Compliance'}, ${dateTime(k.reviewed_at)}`}
                              {k.review_note && `${k.reviewed_at ? ': ' : ''}${k.review_note}`}
                              {k.sale_reinstated && ' (policy reinstated)'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
          )}
        </div>
      </div>

      {dialog === 'call' && (
        <SxDialog title="Log Call" onClose={close} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="sx-btn sx-btn-go" onClick={submitCall} disabled={busy || !form.outcome || form.notes.trim().length < 3}>
              {busy ? 'Saving...' : 'Save Call'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div className="sx-fld">
            <label htmlFor="sx-call-outcome">Outcome:</label>
            <select id="sx-call-outcome" className="sx-select" value={form.outcome} onChange={(e) => setForm((v) => ({ ...v, outcome: e.target.value }))}>
              <option value="">-- how did the call end --</option>
              {outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <div className="sx-fld">
            <label htmlFor="sx-call-notes">What happened:</label>
            <textarea id="sx-call-notes" className="sx-textarea" value={form.notes} maxLength={4000}
              onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))}
              placeholder="What the customer said, why they cancelled, what you offered, what was agreed." />
          </div>
          <div className="sx-fld">
            <label htmlFor="sx-call-follow">Follow up on:</label>
            <div>
              <input id="sx-call-follow" type="datetime-local" className="sx-input" value={form.follow}
                onChange={(e) => setForm((v) => ({ ...v, follow: e.target.value }))} />
              <div className="sx-hint">Optional. Your own time. It appears on your Follow-ups list.</div>
            </div>
          </div>
        </SxDialog>
      )}

      {(dialog === 'saved' || dialog === 'lost') && (
        <SxDialog title={dialog === 'saved' ? 'Customer Saved' : 'Customer Not Saved'} onClose={close} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={`sx-btn ${dialog === 'saved' ? 'sx-btn-go' : 'sx-btn-stop'}`}
              disabled={busy || form.reason.trim().length < (dialog === 'saved' ? 10 : 5)}
              onClick={() => run(
                () => client.post(`support/cases/${c.id}/status`, { status: dialog, reason: form.reason }),
                dialog === 'saved' ? 'Marked saved. Send it to compliance when you are ready.' : 'Marked not saved.',
              )}>
              {busy ? 'Saving...' : dialog === 'saved' ? 'Mark Saved' : 'Mark Not Saved'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div className="sx-fld">
            <label htmlFor="sx-reason">{dialog === 'saved' ? 'How it was saved:' : 'Why not:'}</label>
            <textarea id="sx-reason" className="sx-textarea" value={form.reason} maxLength={4000}
              onChange={(e) => setForm((v) => ({ ...v, reason: e.target.value }))}
              placeholder={dialog === 'saved'
                ? 'What the customer agreed to and why they are staying. Compliance reads this before approving.'
                : 'Why the customer could not be kept on the policy.'} />
          </div>
        </SxDialog>
      )}

      {dialog === 'send' && (
        <SxDialog title="Send to Compliance" onClose={close} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="sx-btn sx-btn-send" disabled={busy}
              onClick={() => run(() => client.post(`support/cases/${c.id}/submit`), 'Sent to compliance for final approval.')}>
              {busy ? 'Sending...' : 'Send'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div>Send <b>{p.customer_name}</b> to compliance for final approval?</div>
          <div className="sx-hint">You cannot log more calls on this customer until compliance approves it or sends it back.</div>
        </SxDialog>
      )}

      {(dialog === 'approve' || dialog === 'return') && (
        <SxDialog title={dialog === 'approve' ? 'Approve Saved Customer' : 'Send Back to Agent'} onClose={close} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={`sx-btn ${dialog === 'approve' ? 'sx-btn-go' : 'sx-btn-stop'}`}
              disabled={busy || (dialog === 'return' && form.reason.trim().length < 5)}
              onClick={() => run(
                () => client.post(`support/cases/${c.id}/review`, { decision: dialog, note: form.reason }),
                dialog === 'approve' ? 'Approved.' : 'Sent back to the agent.',
              )}>
              {busy ? 'Saving...' : dialog === 'approve' ? 'Approve' : 'Send Back'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          {dialog === 'approve' && (
            <div>
              {st.tone === 'cancelled'
                ? <>Approving puts this policy back to <b>Active</b> and clears its cancellation date.</>
                : <>This policy is not cancelled, so approving records the save and leaves the policy as it is.</>}
            </div>
          )}
          <div className="sx-fld">
            <label htmlFor="sx-review-note">{dialog === 'approve' ? 'Note (optional):' : 'What is missing:'}</label>
            <textarea id="sx-review-note" className="sx-textarea" value={form.reason} maxLength={2000}
              onChange={(e) => setForm((v) => ({ ...v, reason: e.target.value }))} />
          </div>
        </SxDialog>
      )}
    </>
  );
}
