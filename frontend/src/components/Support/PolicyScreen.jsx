// ============================================================================
// PolicyScreen -- one policy, the way the support desk's old policy program
// drew it: Contact / Vehicle / Campaign boxes, a grid of boxed read-only
// fields, then Details (always on screen) and under it two tabs: History and
// Payments.
//
// HISTORY IS THE ONE TIMELINE. Calls, closer tags, the saved / not-saved
// decisions and the policy's own events used to be four tabs; they are one
// list now, each line with its time and the person who did it.
//
// The support agent logs calls here, marks the customer Saved / Not Saved, and
// tags a closer. Superadmin / compliance open the same screen from the Support
// reports with mode="view": identical, minus the action buttons.
//
// There is NO compliance approval any more (mig 357): Saved is the end of a
// case and never changes the sale itself.
//
// Every rule is enforced by the server (routes/support.js); `work` from the
// API says whether THIS person may log a call, so the buttons never have to
// re-derive it.
// ============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft, ChevronLeft, ChevronRight, PhoneCall, CheckCircle2, XCircle, RotateCcw,
  RefreshCw, IdCard, Car, UserPlus,
} from 'lucide-react';
import client from '../../api/client';
import SxDialog from './SxDialog';
import { SortTh, useClientSort } from './sxSort';
import {
  money, day, dateTime, num, saleStatus, caseStatus, pretty, vehicle, localInputToIso, errText,
  outcomeOf, toneClass, monthlyDate,
} from './supportFormat';

const Fld = ({ label, value, cls = '', span = '' }) => (
  <div className={`sx-fld ${span}`}>
    <span className="sx-lbl">{label}:</span>
    <div className={`sx-val ${cls}`} title={typeof value === 'string' ? value : undefined}>{value || ' '}</div>
  </div>
);

export default function PolicyScreen({
  saleId, position, onPrev, onNext, onBack, onChanged,
  outcomes = [], mode = 'work',
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('history');
  const [kind, setKind] = useState('');             // History filter
  const [dialog, setDialog] = useState(null);      // 'call' | 'saved' | 'lost' | 'tag'
  const [busy, setBusy] = useState(false);
  const [dlgError, setDlgError] = useState('');
  const [flash, setFlash] = useState('');
  const [form, setForm] = useState({ outcome: '', notes: '', follow: '', reason: '', closer: '' });
  const [closers, setClosers] = useState(null);

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

  useEffect(() => { setTab('history'); setKind(''); setFlash(''); load(); }, [load]);

  // One timeline out of everything that happened on this policy.
  const timeline = useMemo(() => {
    if (!data) return [];
    const rows = [];
    (data.calls || []).forEach((k) => rows.push({
      id: `call-${k.id}`, at: k.called_at, kind: 'call', type: 'Call', who: k.agent_name,
      what: outcomeOf(outcomes, k.outcome)?.label || pretty(k.outcome), detail: k.notes,
      follow: k.follow_up_at, cls: toneClass(outcomes, k.outcome),
    }));
    (data.tags || []).forEach((t) => {
      rows.push({
        id: `tag-${t.id}`, at: t.created_at, kind: 'tag', type: 'Tag', who: t.tagged_by_name,
        what: `Tagged closer ${t.tagged_name || ''}`.trim(), detail: t.note,
        pill: t.status === 'done' ? ['green', 'Done'] : ['amber', 'Waiting'],
      });
      if (t.status === 'done') {
        rows.push({
          id: `tagdone-${t.id}`, at: t.done_at, kind: 'tag', type: 'Tag', who: t.tagged_name,
          what: 'Closer finished the request', detail: t.closer_note,
        });
      }
    });
    (data.cases || []).forEach((k) => {
      rows.push({ id: `case-${k.id}`, at: k.created_at, kind: 'status', type: 'Status', who: k.agent_name, what: 'Started working this customer', pill: ['cs-open', 'In Progress'] });
      if (k.status === 'saved') rows.push({ id: `saved-${k.id}`, at: k.saved_at || k.updated_at, kind: 'status', type: 'Status', who: k.agent_name, what: 'Customer', detail: k.save_reason, pill: ['cs-saved', 'Saved'] });
      if (k.status === 'lost') rows.push({ id: `lost-${k.id}`, at: k.updated_at, kind: 'status', type: 'Status', who: k.agent_name, what: 'Customer', detail: k.lost_reason, pill: ['cs-lost', 'Not Saved'] });
    });
    (data.history || []).forEach((h) => rows.push({
      id: `ev-${h.id}`, at: h.at, kind: 'policy', type: 'Policy', who: h.actor_name, what: pretty(h.event_type), detail: h.note,
    }));
    // Newest first until a header is clicked. Compared as instants: the
    // sources do not all print their timestamps the same way.
    return rows.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }, [data, outcomes]);
  const shown = useMemo(() => (kind ? timeline.filter((r) => r.kind === kind) : timeline), [timeline, kind]);
  const history = useClientSort(shown, {
    when: (r) => Date.parse(r.at) || 0, type: (r) => r.type, by: (r) => r.who, what: (r) => r.what,
    detail: (r) => r.detail, follow: (r) => r.follow,
  });

  const open = async (kind) => {
    setForm({ outcome: '', notes: '', follow: '', reason: '', closer: data?.policy?.closer_id || '' });
    setDlgError(''); setDialog(kind);
    if (kind === 'tag' && !closers) {
      try {
        const r = await client.get('support/closers');
        const list = r.data.closers || [];
        setClosers(list);
        // The sale's own closer is the usual person to tag, when they still work here.
        setForm((v) => ({ ...v, closer: list.some((c) => c.user_id === v.closer) ? v.closer : '' }));
      } catch (e) {
        setClosers([]);
        setDlgError(errText(e, 'Could not load the closers.'));
      }
    } else if (kind === 'tag') {
      setForm((v) => ({ ...v, closer: closers.some((c) => c.user_id === v.closer) ? v.closer : '' }));
    }
  };
  const close = () => { if (!busy) setDialog(null); };

  // Run one write, then re-read the policy so the screen is what the server has.
  const run = async (fn, okText, thenTab) => {
    setBusy(true); setDlgError('');
    try {
      await fn();
      setDialog(null);
      setFlash(okText);
      await load();
      if (thenTab) setTab(thenTab);
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
  const canLog = isWork && data.work?.can;
  const mine = !!c && canLog;
  const openTags = data.tags.filter((t) => t.status === 'open').length;
  const cityLine = [f.City, [f.State, f.Zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const address = p.customer_address || f.Address || '';
  const lastOutcome = c ? outcomeOf(outcomes, c.last_outcome) : null;

  const TABS = [
    ['history', `History (${timeline.length})`],
    ['payments', 'Payments'],
  ];
  const KINDS = [['', 'Everything'], ['call', 'Calls'], ['tag', 'Tags'], ['status', 'Saved / Not Saved'], ['policy', 'Policy events']];

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
            <button type="button" className="sx-tool" onClick={() => open('tag')} disabled={!canLog}><UserPlus size={15} /> Tag Closer</button>
            <span className="sx-tool-sep" />
            <button type="button" className="sx-tool" onClick={() => open('saved')} disabled={!mine || c?.status !== 'open'}><CheckCircle2 size={15} /> Customer Saved</button>
            <button type="button" className="sx-tool" onClick={() => open('lost')} disabled={!mine}><XCircle size={15} /> Not Saved</button>
            {mine && c?.status === 'saved' && (
              <button type="button" className="sx-tool" disabled={busy}
                onClick={() => run(() => client.post(`support/cases/${c.id}/status`, { status: 'open' }), 'Case is back In Progress.')}>
                <RotateCcw size={15} /> Reopen
              </button>
            )}
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
        {openTags > 0 && (
          <div className="sx-note">
            {openTags === 1 ? 'A closer is tagged on this policy and has not finished yet.' : `${openTags} closers are tagged on this policy and have not finished yet.`}
            {' '}<button type="button" className="sx-link" onClick={() => { setTab('history'); setKind('tag'); }}>See tags</button>
          </div>
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
          <Fld label="Monthly Date" value={monthlyDate(f.Monthly_Date)} />
          <Fld label="Payment Duration" value={f.Payment_Duration} />

          <Fld label="Vehicle Odometer" value={num(p.car_miles) || f.Miles} />
          <Fld label="State" value={f.State} />
          <Fld label="Company" value={p.company_name} />

          <Fld label="Cancel Date" value={day(p.cancellation_date)} />
          <Fld label="Cancel Reason" value={pretty(p.cancellation_reason_key)} />
          <Fld label="Retention" value={cs ? `${cs.label}${c.agent_name ? ` - ${c.agent_name}` : ''}` : 'Not started'}
            cls={c ? `cs-${c.status}` : ''} />

          <Fld label="Last Call" value={dateTime(c?.last_call_at)} />
          <Fld label="Last Outcome" value={lastOutcome?.label} />
          <Fld label="Follow up on" value={dateTime(c?.next_follow_up_at)} />
        </div>

        <div className="sx-section">
          <div className="sx-section-title">Details</div>
          <div className="sx-pane">
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

              <Fld label="Last Updated" value={dateTime(p.updated_at)} />
              {c?.save_reason && <Fld label="Notes" value={c.save_reason} cls="wrap" span="span3" />}
              {p.compliance_note && <Fld label="Sale Note" value={p.compliance_note} cls="wrap" span="span3" />}
            </div>
          </div>
        </div>

        <div className="sx-subtabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="sx-subtab" onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        <div className="sx-pane" role="tabpanel">
          {tab === 'payments' && (
            <div className="sx-form">
              <Fld label="Down Payment" value={money(p.down_payment)} cls="money" />
              <Fld label="Monthly Payment" value={money(p.monthly_payment)} cls="money" />
              <Fld label="Monthly Date" value={monthlyDate(f.Monthly_Date)} />
              <Fld label="Payment Duration" value={f.Payment_Duration} />
              <Fld label="Term Months" value={f.PlanDuration} />
              <Fld label="Chargeback Date" value={day(p.chargeback_date)} />
              <Fld label="Chargeback Amt" value={money(p.chargeback_amount)} cls="money" />
              <Fld label="Payment Note" value={p.payment_due_note} cls="wrap" span="span2" />
            </div>
          )}

          {tab === 'history' && (
            <>
              <div className="sx-searchbar" style={{ padding: '0 0 6px', border: 'none', background: 'none' }}>
                <label htmlFor="sx-hist-kind">Show:</label>
                <select id="sx-hist-kind" className="sx-select" style={{ width: 200 }} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <span className="sx-hint">Calls, closer tags, saved / not saved and policy events. Newest first. Times are US Eastern.</span>
              </div>
              {history.sorted.length === 0
                ? (
                  <div className="sx-empty">
                    {timeline.length > 0 ? 'Nothing of that kind on this policy.'
                      : `Nothing has happened on this policy yet.${canLog ? ' Use Log Call after you speak to the customer.' : ''}`}
                  </div>
                )
                : (
                  <div className="sx-gridwrap">
                    <table className="sx-grid">
                      <thead><tr>
                        <SortTh label="Date / Time (ET)" k="when" sort={history.sort} onSort={history.setSort} />
                        <SortTh label="Type" k="type" sort={history.sort} onSort={history.setSort} />
                        <SortTh label="By" k="by" sort={history.sort} onSort={history.setSort} />
                        <SortTh label="What" k="what" sort={history.sort} onSort={history.setSort} />
                        <SortTh label="Notes" k="detail" sort={history.sort} onSort={history.setSort} />
                        <SortTh label="Follow-up" k="follow" sort={history.sort} onSort={history.setSort} />
                      </tr></thead>
                      <tbody>
                        {history.sorted.map((h) => (
                          <tr key={h.id} className={h.cls || ''}>
                            <td className="nowrap">{dateTime(h.at)}</td>
                            <td className="nowrap">{h.type}</td>
                            <td className="nowrap">{h.who}</td>
                            <td className="nowrap">{h.what}{h.pill && <> <span className={`sx-pill ${h.pill[0]}`}>{h.pill[1]}</span></>}</td>
                            <td className="story">{h.detail}</td>
                            <td className="nowrap">{dateTime(h.follow)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </>
          )}
        </div>
      </div>

      {dialog === 'call' && (
        <SxDialog title="Log Call" onClose={close} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="sx-btn sx-btn-go" disabled={busy || !form.outcome || form.notes.trim().length < 3}
              onClick={() => run(
                () => client.post(`support/policies/${p.id}/calls`, {
                  outcome: form.outcome, notes: form.notes, follow_up_at: localInputToIso(form.follow),
                }),
                form.follow ? 'Call logged. You will be reminded at the follow-up time.' : 'Call logged.',
                'history',
              )}>
              {busy ? 'Saving...' : 'Save Call'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div className="sx-fld">
            <label htmlFor="sx-call-outcome">Outcome:</label>
            <div>
              <select id="sx-call-outcome" className={`sx-select ${toneClass(outcomes, form.outcome)}`} value={form.outcome}
                onChange={(e) => setForm((v) => ({ ...v, outcome: e.target.value }))}>
                <option value="">-- how did the call end --</option>
                {outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <div className="sx-hint">The outcome sets this customer&apos;s colour in your lists.</div>
            </div>
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
              <div className="sx-hint">Optional, in your own time. You get a notification when it is due.</div>
            </div>
          </div>
        </SxDialog>
      )}

      {dialog === 'tag' && (
        <SxDialog title="Tag Closer" onClose={close} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="sx-btn sx-btn-send" disabled={busy || !form.closer || form.notes.trim().length < 3}
              onClick={() => run(
                () => client.post(`support/policies/${p.id}/tags`, { user_id: form.closer, note: form.notes }),
                'Closer tagged. They have been notified.',
                'history',
              )}>
              {busy ? 'Tagging...' : 'Tag Closer'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div>The closer you pick gets a notification, and this policy appears under Support Requests on their dashboard until they mark it done.</div>
          <div className="sx-fld">
            <label htmlFor="sx-tag-closer">Closer:</label>
            <select id="sx-tag-closer" className="sx-select" value={form.closer} disabled={!closers}
              onChange={(e) => setForm((v) => ({ ...v, closer: e.target.value }))}>
              <option value="">{closers ? '-- pick a closer --' : 'Loading closers...'}</option>
              {(closers || []).map((k) => (
                <option key={k.user_id} value={k.user_id}>{k.name}{k.user_id === p.closer_id ? ' (sold this policy)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="sx-fld">
            <label htmlFor="sx-tag-note">What you need:</label>
            <textarea id="sx-tag-note" className="sx-textarea" value={form.notes} maxLength={1000}
              onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))}
              placeholder="What the closer should do, e.g. call the customer back about the new payment date." />
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
                dialog === 'saved' ? 'Customer marked Saved.' : 'Customer marked Not Saved.',
                'history',
              )}>
              {busy ? 'Saving...' : dialog === 'saved' ? 'Mark Saved' : 'Mark Not Saved'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div className="sx-fld">
            <label htmlFor="sx-reason">{dialog === 'saved' ? 'Notes:' : 'Why not:'}</label>
            <textarea id="sx-reason" className="sx-textarea" value={form.reason} maxLength={4000}
              onChange={(e) => setForm((v) => ({ ...v, reason: e.target.value }))}
              placeholder={dialog === 'saved'
                ? 'What the customer agreed to and why they are staying.'
                : 'Why the customer could not be kept on the policy.'} />
          </div>
          {dialog === 'saved' && (
            <div className="sx-hint">This records the save in your reports. It does not change the policy status.</div>
          )}
        </SxDialog>
      )}
    </>
  );
}
