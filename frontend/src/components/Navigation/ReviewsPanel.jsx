// ============================================================================
// ReviewsPanel — the Review section.
//
// WHAT WAS WRONG. This panel read call_reviews + call_dispositions, and both
// tables hold ZERO rows in production while qa_reviews holds 1,050 evaluations.
// The filters were not broken logic -- they were filtering nothing, so every
// combination answered "No call ratings found". The fix is therefore not the
// filters; it is reading from where the reviewed-call data actually lives.
//
// QA Evaluations is now the primary view, backed by GET /reviews/qa: one row per
// evaluated call with the rating QA gave, the call's disposition, who was
// reviewed and by whom. The two original tabs are kept -- the closer-facing
// POST endpoints that feed them still exist, so they can fill up -- but they
// now say plainly that they are empty and why, instead of looking broken.
//
// PHONE SEARCH IS INDEPENDENT. "What happened on this number" must not come
// back empty because an agent or date filter was left set from the previous
// question, so a phone search overrides the filter row and the UI says so. The
// server enforces the same rule and reports it back as `phone_search`.
// ============================================================================
import { useState, useCallback, useEffect } from 'react';
import {
  Star, Search, X, Phone, ShieldCheck, AlertTriangle, ChevronDown, ChevronRight, Filter,
} from 'lucide-react';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, PillTabs, TableScroll, Loading, EmptyState, Field, accent } from '../UI/kit';

const PAGE_SIZE = 25;
// The closer-facing rating vocabulary, kept for the legacy tabs.
const RATING_COLOR = {
  excellent: '#16a34a', good: '#65a30d', average: '#d97706',
  below_average: '#ea580c', bad: '#dc2626',
};

const fmtDateTime = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return String(d); }
};
const fmtPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '—');
};

// Tone is a display heuristic only; `passed` is the scorecard's own verdict and
// it wins the label.
const scoreTone = (s, passed) => {
  if (passed === false) return 'danger';
  if (passed === true) return 'success';
  if (s == null) return 'muted';
  return s >= 80 ? 'success' : s >= 60 ? 'warn' : 'danger';
};

function Rating({ score, max, passed }) {
  const a = accent(scoreTone(score, passed));
  if (score == null) return <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md"
        style={{ color: a.fg, background: a.soft }}>
        {score}{max ? `/${max}` : ''}
      </span>
      {passed != null && (
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: a.fg }}>
          {passed ? 'pass' : 'fail'}
        </span>
      )}
    </span>
  );
}

// One evaluation, expandable into its per-criterion breakdown (which the server
// only sends on a phone investigation).
function QaRow({ r, expanded, onToggle }) {
  const canExpand = Array.isArray(r.criteria) && r.criteria.length > 0;
  return (
    <>
      <tr onClick={canExpand ? onToggle : undefined}
        className={canExpand ? 'cursor-pointer transition-colors hover:bg-bg-secondary' : ''}
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="inline-flex items-center gap-1">
            {canExpand && (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
            {fmtDateTime(r.created_at)}
          </span>
        </td>
        <td className="px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{r.agent_name}</td>
        <td className="px-3 py-2.5 text-xs uppercase font-bold" style={{ color: 'var(--color-text-tertiary)' }}>{r.method || '—'}</td>
        <td className="px-3 py-2.5"><Rating score={r.score} max={r.max_score} passed={r.passed} /></td>
        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.disposition || '—'}</td>
        <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
          {r.customer_name || '—'}
          <span className="block font-mono text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtPhone(r.customer_phone)}</span>
        </td>
        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.reviewer_name}</td>
      </tr>
      {expanded && canExpand && (
        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <td colSpan={7} className="px-3 py-3">
            <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
              QA evaluation detail
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {r.criteria.map((c, i) => (
                <div key={i} className="rounded-lg px-2.5 py-1.5"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <p className="m-0 text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {String(c.criterion_key || '').replace(/_/g, ' ')}
                  </p>
                  <p className="m-0 text-[11px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                    {c.points != null ? `${c.points} pts` : ''}{c.raw_value ? ` · ${c.raw_value}` : ''}
                  </p>
                  {c.note && <p className="m-0 mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{c.note}</p>}
                </div>
              ))}
            </div>
            {r.notes && (
              <p className="m-0 mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-semibold">Reviewer notes: </span>{r.notes}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const Pager = ({ page, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 mt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <span className="flex items-center gap-2">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="px-2.5 py-1 rounded-lg border text-xs font-semibold disabled:opacity-40"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Prev</button>
        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{page} / {pages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages}
          className="px-2.5 py-1 rounded-lg border text-xs font-semibold disabled:opacity-40"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Next</button>
      </span>
    </div>
  );
};

const ReviewsPanel = ({ companyId: companyIdProp }) => {
  const companyId = companyIdProp;

  const [tab, setTab] = useState('qa');
  const [agentsList, setAgentsList] = useState([]);

  // QA view
  const [qaRows, setQaRows]   = useState([]);
  const [qaTotal, setQaTotal] = useState(0);
  const [qaPage, setQaPage]   = useState(1);
  const [agent, setAgent]     = useState('');
  const [method, setMethod]   = useState('');
  const [result, setResult]   = useState('');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  // `phoneInput` is what is typed; `phone` is what has been submitted. Keeping
  // them apart means a half-typed number never narrows the list.
  const [phoneInput, setPhoneInput]   = useState('');
  const [phone, setPhone]             = useState('');
  const [phoneActive, setPhoneActive] = useState(false);
  const [expanded, setExpanded]       = useState(null);

  // Legacy views
  const [reviews, setReviews] = useState([]);
  const [dispos, setDispos]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    if (!companyId) return;
    client.get('users', { params: { company_id: companyId } })
      .then(r => setAgentsList(r.data.users || []))
      .catch(() => {});
  }, [companyId]);

  const loadQa = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = { limit: PAGE_SIZE, page: qaPage };
      if (companyId) params.company_id = companyId;
      if (phone) {
        // Deliberately the ONLY filter sent: an investigation must not be
        // silently narrowed by whatever was set for the previous question.
        params.phone = phone;
      } else {
        if (agent)  params.subject_user_id = agent;
        if (method) params.method = method;
        if (result) params.result = result;
        if (from)   params.date_from = from;
        if (to)     params.date_to = to;
      }
      const r = await client.get('reviews/qa', { params });
      setQaRows(r.data.reviews || []);
      setQaTotal(r.data.total || 0);
      setPhoneActive(!!r.data.phone_search);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load QA evaluations');
    } finally { setLoading(false); }
  }, [companyId, qaPage, agent, method, result, from, to, phone]);

  const loadLegacy = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        client.get('reviews', { params: { company_id: companyId, limit: PAGE_SIZE, page: 1 } }),
        client.get('reviews/dispositions', { params: { company_id: companyId, limit: PAGE_SIZE, page: 1 } }),
      ]);
      setReviews(rRes.data.reviews || []);
      setDispos(dRes.data.dispositions || []);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { if (tab === 'qa') loadQa(); else loadLegacy(); }, [tab, loadQa, loadLegacy]);

  const submitPhone = (e) => {
    e?.preventDefault?.();
    setPhone(phoneInput.trim());
    setQaPage(1);
    setExpanded(null);
  };
  const clearPhone = () => { setPhoneInput(''); setPhone(''); setQaPage(1); };
  const onFilter = (setter) => (v) => { setter(v); setQaPage(1); };

  const activeFilterCount = [agent, method, result, from, to].filter(Boolean).length;
  const legacyRows = tab === 'ratings' ? reviews : dispos;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8 space-y-4 animate-fade-in">
      <SectionHeader
        level="page"
        icon={Star}
        title="Review"
        subtitle="QA-evaluated calls: the rating QA gave, the call's disposition, and the evaluation behind it."
      />

      <PillTabs
        items={[
          { key: 'qa', label: 'QA Evaluations', icon: ShieldCheck },
          { key: 'ratings', label: 'Closer Ratings' },
          { key: 'dispos', label: 'Closer Dispositions' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'qa' ? (
        <Panel pad="lg">
          {/* ── Phone investigation. Its own row, above the filters, because it
                 replaces them rather than joining them. ────────────────────── */}
          <form onSubmit={submitPhone} className="flex items-end gap-2 flex-wrap mb-3">
            <Field label="Investigate a phone number" as="div" className="flex-1 min-w-[13rem]">
              <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <Phone size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                <input
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  placeholder="e.g. (918) 843-5206"
                  className="flex-1 bg-transparent outline-none text-sm font-mono"
                  style={{ color: 'var(--color-text)' }}
                />
                {phone && (
                  <button type="button" onClick={clearPhone} title="Clear the number">
                    <X size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                  </button>
                )}
              </div>
            </Field>
            <button type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Search size={13} /> Search
            </button>
          </form>

          {phoneActive && (
            <p className="m-0 mb-3 text-xs rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap"
              style={{ background: accent('info').soft, color: accent('info').fg }}>
              <Phone size={13} />
              Showing every QA evaluation for {fmtPhone(phone)} — the filters below are ignored while a number is being investigated.
              <button onClick={clearPhone} className="font-bold underline">Clear</button>
            </p>
          )}

          {/* ── The general filters. Dimmed and inert during a phone search
                 rather than hidden: removing them would make the state look
                 like a different page. ─────────────────────────────────────── */}
          <div className="flex items-end gap-3 flex-wrap mb-4"
            style={{ opacity: phoneActive ? 0.45 : 1, pointerEvents: phoneActive ? 'none' : undefined }}>
            <Field label="Agent" as="div" className="min-w-[11rem]">
              <ThemedSelect value={agent} onChange={e => onFilter(setAgent)(e.target.value)} className="input text-xs">
                <option value="">All agents</option>
                {agentsList.map(u => (
                  <option key={u.user_id || u.id} value={u.user_id || u.id}>
                    {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email}
                  </option>
                ))}
              </ThemedSelect>
            </Field>
            <Field label="Method" as="div" className="min-w-[8rem]">
              <ThemedSelect value={method} onChange={e => onFilter(setMethod)(e.target.value)} className="input text-xs">
                <option value="">All methods</option>
                <option value="rcm">RCM</option>
                <option value="tra">TRA</option>
              </ThemedSelect>
            </Field>
            <Field label="Result" as="div" className="min-w-[8rem]">
              <ThemedSelect value={result} onChange={e => onFilter(setResult)(e.target.value)} className="input text-xs">
                <option value="">Pass or fail</option>
                <option value="pass">Passed</option>
                <option value="fail">Failed</option>
              </ThemedSelect>
            </Field>
            <Field label="From" as="div" className="w-[9.5rem]">
              <ThemedDate value={from} onChange={e => onFilter(setFrom)(e.target.value)} className="input text-xs" />
            </Field>
            <Field label="To" as="div" className="w-[9.5rem]">
              <ThemedDate value={to} onChange={e => onFilter(setTo)(e.target.value)} className="input text-xs" />
            </Field>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setAgent(''); setMethod(''); setResult(''); setFrom(''); setTo(''); setQaPage(1); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <Filter size={12} /> Clear {activeFilterCount}
              </button>
            )}
          </div>

          {err ? <EmptyState compact icon={AlertTriangle} title="Couldn't load QA evaluations" hint={err} />
            : loading ? <Loading variant="table" rows={6} />
            : qaRows.length === 0 ? (
              <EmptyState icon={ShieldCheck}
                title={phoneActive ? 'No QA evaluation for that number' : 'No QA evaluations match'}
                hint={phoneActive
                  ? 'That number has not been reviewed by QA, or it belongs to another company.'
                  : 'Try a wider date range, or clear the filters.'} />
            ) : (
              <>
                <TableScroll stickyFirst label="QA evaluations">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        {['Reviewed', 'Agent', 'Method', 'Rating', 'Disposition', 'Customer', 'Reviewer'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                            style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {qaRows.map(r => (
                        <QaRow key={r.id} r={r} expanded={expanded === r.id}
                          onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <Pager page={qaPage} total={qaTotal} onPage={setQaPage} />
              </>
            )}
        </Panel>
      ) : (
        <Panel pad="lg">
          {/* These two read call_reviews / call_dispositions -- the closer-facing
              review flow. Both are empty in production. Saying that outright is
              better than an empty table that reads as a broken filter. */}
          {loading ? <Loading variant="table" rows={4} /> : (
            legacyRows.length === 0 ? (
              <EmptyState icon={Star}
                title={`No closer ${tab === 'ratings' ? 'ratings' : 'dispositions'} recorded`}
                hint="This is the closer-submitted review flow, which nobody has used yet. QA's own evaluations are on the QA Evaluations tab." />
            ) : (
              <TableScroll label={tab === 'ratings' ? 'Closer ratings' : 'Closer dispositions'}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['When', 'Closer', tab === 'ratings' ? 'Rating' : 'Disposition', 'Notes'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide"
                          style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {legacyRows.map(x => (
                      <tr key={x.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDateTime(x.created_at)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--color-text)' }}>
                          {[x.user_profiles?.first_name, x.user_profiles?.last_name].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold"
                          style={{ color: RATING_COLOR[x.rating] || 'var(--color-text)' }}>
                          {(x.rating || x.disposition || '—').replace(/_/g, ' ')}
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{x.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )
          )}
        </Panel>
      )}
    </div>
  );
};

export default ReviewsPanel;
