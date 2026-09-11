// ============================================================================
// TrainingManager -- the side of the portal that puts the material there.
//
// Reached by a compliance manager (usually through the superadmin designation,
// User Control Center → Modules → Training) or by the fronter manager who runs
// the floor the new hires are on. Both see the same screen; the API decides
// which companies they may write to, so this file never has to.
//
// UPLOADS ARE TWO STEPS ON PURPOSE: POST /upload stores the file and hands back
// a URL, then POST /documents saves the row that points at it. One combined
// call would mean a 25MB body replayed on every validation slip -- with two, a
// missing title costs a re-click and not a re-upload.
//
// DELETES ARE REAL. There is no archive-then-forget here: the eye hides a row
// from trainees, the bin removes it and its stored file. Both are offered
// because "we are not using this any more" and "this should never have been
// uploaded" are different problems.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Headphones, MessageSquareWarning, Volume2, BarChart3, Upload, Plus,
  Trash2, Eye, EyeOff, Save, X, GraduationCap, CheckCircle2, ListPlus,
} from 'lucide-react';
import client from '../../api/client';
import { Alert, Button } from '../UI';
import { Panel, SectionHeader, PillTabs, EmptyState, Loading, Field, useFlash, accent } from '../UI/kit';

const err = (e, fallback) => e?.response?.data?.error || fallback;

// Read a File into the bare base64 the upload endpoint wants. readAsDataURL
// gives "data:application/pdf;base64,JVBER..." -- the route accepts either
// form, but stripping the prefix here keeps the payload honest about its size.
const toBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',').pop());
  fr.onerror = () => reject(new Error('Could not read that file'));
  fr.readAsDataURL(file);
});

const bytes = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ── a row in any of the content lists ────────────────────────────────────────
function ItemRow({ title, sub, meta, active, onToggle, onDelete, busy }) {
  return (
    <div className="rounded-xl p-3 flex items-start gap-3"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        opacity: active ? 1 : 0.6,
      }}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>
          {title}
          {!active && (
            <span className="text-[10px] font-normal ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
              hidden
            </span>
          )}
        </p>
        {sub && <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>}
        {meta && <p className="text-[10px] m-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{meta}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onToggle} disabled={busy} title={active ? 'Hide from trainees' : 'Show to trainees'}
          aria-label={active ? 'Hide from trainees' : 'Show to trainees'}
          className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40"
          style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
          {active ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button onClick={onDelete} disabled={busy} title="Delete permanently" aria-label="Delete permanently"
          className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40"
          style={{ background: 'color-mix(in srgb, var(--color-error-600) 10%, transparent)', color: 'var(--color-error-600)' }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Documents and Recordings share everything but a mime type ────────────────
function MediaManager({ kind, companyId, flash }) {
  const isDoc  = kind === 'document';
  const path   = isDoc ? 'documents' : 'recordings';
  const accept = isDoc ? 'application/pdf' : 'audio/*';

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [form, setForm]       = useState({ title: '', description: '', category: '' });
  const [file, setFile]       = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = companyId ? `?company_id=${companyId}&include_inactive=1` : '?include_inactive=1';
    client.get(`training/${path}${params}`)
      .then(r => setRows(r.data[path] || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [companyId, path]);
  useEffect(load, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return flash('error', 'Give it a title first.');
    if (!file) return flash('error', `Choose ${isDoc ? 'a PDF' : 'an audio file'} to upload.`);
    setBusy(true);
    try {
      const data = await toBase64(file);
      const up = await client.post('training/upload', {
        kind, type: file.type, name: file.name, data, company_id: companyId || undefined,
      });
      const f = up.data.file;
      await client.post(`training/${path}`, {
        ...form,
        company_id: companyId || undefined,
        file_url: f.url, storage_path: f.storage_path,
        file_name: f.name, file_size: f.size, type: f.type,
      });
      flash('success', `"${form.title}" is live for trainees.`);
      setForm({ title: '', description: '', category: '' });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e2) {
      flash('error', err(e2, 'Upload failed.'));
    } finally { setBusy(false); }
  };

  const toggle = async (row) => {
    setBusy(true);
    try {
      await client.put(`training/${path}/${row.id}`, { is_active: !row.is_active });
      load();
    } catch (e2) { flash('error', err(e2, 'Could not change that.')); }
    finally { setBusy(false); }
  };

  const remove = async (row) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${row.title}" and its file? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await client.delete(`training/${path}/${row.id}`);
      flash('success', 'Deleted.');
      load();
    } catch (e2) { flash('error', err(e2, 'Could not delete that.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Panel tone="inset" radius="xl" pad="lg">
        <SectionHeader level="sub" icon={isDoc ? BookOpen : Headphones}
          title={isDoc ? 'Upload a document' : 'Upload a recording'} />
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" required>
              <input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                className="input text-sm py-2 w-full"
                placeholder={isDoc ? 'Warranty basics' : 'Good rebuttal — price objection'} />
            </Field>
            <Field label="Category" hint="Groups the cards into tabs. Optional.">
              <input value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                className="input text-sm py-2 w-full" placeholder="Onboarding" />
            </Field>
          </div>
          <Field label="What it is for" hint="One line, shown under the title on the card.">
            <input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              className="input text-sm py-2 w-full" />
          </Field>
          <Field label={isDoc ? 'PDF file' : 'Audio file'} required hint="Up to 25 MB.">
            <input ref={fileRef} type="file" accept={accept}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm w-full" />
          </Field>
          {file && (
            <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
              {file.name} · {bytes(file.size)}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            <Upload size={14} className="mr-1.5" />{busy ? 'Uploading…' : 'Upload'}
          </Button>
        </form>
      </Panel>

      {loading ? <Loading variant="rows" rows={3} /> : (
        rows.length === 0
          ? <EmptyState icon={isDoc ? BookOpen : Headphones} compact
              title={`No ${path} yet`} hint="Whatever you upload appears on the trainee's tab straight away." />
          : (
            <div className="space-y-2">
              {rows.map(r => (
                <ItemRow key={r.id} title={r.title} sub={r.description}
                  meta={[r.category, bytes(r.file_size)].filter(Boolean).join(' · ')}
                  active={r.is_active} busy={busy}
                  onToggle={() => toggle(r)} onDelete={() => remove(r)} />
              ))}
            </div>
          )
      )}
    </div>
  );
}

// ── Scenarios ────────────────────────────────────────────────────────────────
const blankOption = () => ({ label: '', disposition: '', is_correct: false, feedback: '' });

function ScenarioManager({ companyId, flash }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [form, setForm] = useState({ title: '', situation: '', guidance: '', category: '' });
  const [options, setOptions] = useState([blankOption(), blankOption()]);

  const load = useCallback(() => {
    setLoading(true);
    const params = companyId ? `?company_id=${companyId}&include_inactive=1` : '?include_inactive=1';
    client.get(`training/scenarios${params}`)
      .then(r => setRows(r.data.scenarios || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [companyId]);
  useEffect(load, [load]);

  const setOpt = (i, patch) => setOptions(o => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.situation.trim()) {
      return flash('error', 'A scenario needs a title and a situation.');
    }
    const clean = options.filter(o => o.label.trim());
    if (clean.length < 2) return flash('error', 'Give them at least two dispositions to choose between.');
    setBusy(true);
    try {
      await client.post('training/scenarios', {
        ...form,
        company_id: companyId || undefined,
        options: clean.map((o, i) => ({ ...o, sort_order: i })),
      });
      flash('success', 'Scenario added.');
      setForm({ title: '', situation: '', guidance: '', category: '' });
      setOptions([blankOption(), blankOption()]);
      load();
    } catch (e2) { flash('error', err(e2, 'Could not save that.')); }
    finally { setBusy(false); }
  };

  const toggle = async (row) => {
    setBusy(true);
    try { await client.put(`training/scenarios/${row.id}`, { is_active: !row.is_active }); load(); }
    catch (e2) { flash('error', err(e2, 'Could not change that.')); }
    finally { setBusy(false); }
  };

  const remove = async (row) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${row.title}"? Its dispositions go with it.`)) return;
    setBusy(true);
    try { await client.delete(`training/scenarios/${row.id}`); flash('success', 'Deleted.'); load(); }
    catch (e2) { flash('error', err(e2, 'Could not delete that.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Panel tone="inset" radius="xl" pad="lg">
        <SectionHeader level="sub" icon={MessageSquareWarning} title="Write a scenario" />
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" required>
              <input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                className="input text-sm py-2 w-full" placeholder="Customer says they already have coverage" />
            </Field>
            <Field label="Category">
              <input value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                className="input text-sm py-2 w-full" placeholder="Objections" />
            </Field>
          </div>
          <Field label="The situation" required hint="What the trainee reads. Write it the way the call actually goes.">
            <textarea value={form.situation} onChange={(e) => setForm(f => ({ ...f, situation: e.target.value }))}
              rows={4} className="input text-sm py-2 w-full" />
          </Field>
          <Field label="Guidance" hint="Shown after they answer. This is where the teaching happens.">
            <textarea value={form.guidance} onChange={(e) => setForm(f => ({ ...f, guidance: e.target.value }))}
              rows={2} className="input text-sm py-2 w-full" />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--color-text-secondary)' }}>Dispositions they can pick</span>
              <button type="button" onClick={() => setOptions(o => [...o, blankOption()])}
                className="text-[11px] font-semibold flex items-center gap-1"
                style={{ color: 'var(--color-primary-600)' }}>
                <Plus size={12} /> Add another
              </button>
            </div>
            {/* Tick none and the scenario becomes a discussion piece rather
                than a test -- the trainee is told several answers work. */}
            <p className="text-[11px] m-0 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
              Tick the right one. Leave every box unticked and the trainee is told more than one answer works,
              and sees your guidance instead of a verdict.
            </p>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="rounded-xl p-2.5"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2">
                    <input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })}
                      placeholder="What the option says" className="input text-sm py-1.5 flex-1" />
                    <input value={o.disposition} onChange={(e) => setOpt(i, { disposition: e.target.value })}
                      placeholder="Code" className="input text-sm py-1.5" style={{ width: 96 }} />
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                      style={{ color: 'var(--color-text-secondary)' }}>
                      <input type="checkbox" checked={o.is_correct}
                        onChange={(e) => setOpt(i, { is_correct: e.target.checked })}
                        style={{ accentColor: 'var(--color-success-600)' }} />
                      Right
                    </label>
                    {options.length > 2 && (
                      <button type="button" onClick={() => setOptions(x => x.filter((_, j) => j !== i))}
                        aria-label="Remove this option"
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ color: 'var(--color-error-600)' }}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <input value={o.feedback} onChange={(e) => setOpt(i, { feedback: e.target.value })}
                    placeholder="What to tell them if they pick this (optional)"
                    className="input text-xs py-1.5 w-full mt-2" />
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={busy}>
            <Save size={14} className="mr-1.5" />{busy ? 'Saving…' : 'Add scenario'}
          </Button>
        </form>
      </Panel>

      {loading ? <Loading variant="rows" rows={3} /> : (
        rows.length === 0
          ? <EmptyState icon={MessageSquareWarning} compact title="No scenarios yet"
              hint="Write the calls that actually trip new agents up." />
          : (
            <div className="space-y-2">
              {rows.map(r => (
                <ItemRow key={r.id} title={r.title}
                  sub={r.situation.length > 140 ? `${r.situation.slice(0, 140)}…` : r.situation}
                  meta={[r.category, `${(r.options || []).length} options`].filter(Boolean).join(' · ')}
                  active={r.is_active} busy={busy}
                  onToggle={() => toggle(r)} onDelete={() => remove(r)} />
              ))}
            </div>
          )
      )}
    </div>
  );
}

// ── Tool Kit word lists ──────────────────────────────────────────────────────
function TermManager({ companyId, flash }) {
  const [kind, setKind]   = useState('name');
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]   = useState(false);
  const [one, setOne]     = useState({ term: '', phonetic: '', note: '' });
  const [bulk, setBulk]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ kind });
    if (companyId) params.set('company_id', companyId);
    client.get(`training/toolkit?${params.toString()}`)
      .then(r => setRows(kind === 'name' ? (r.data.names || []) : (r.data.extras || [])))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [kind, companyId]);
  useEffect(load, [load]);

  const addOne = async (e) => {
    e.preventDefault();
    if (!one.term.trim()) return flash('error', 'Type the word first.');
    setBusy(true);
    try {
      await client.post('training/terms', { ...one, kind, company_id: companyId || undefined });
      flash('success', `"${one.term}" added.`);
      setOne({ term: '', phonetic: '', note: '' });
      load();
    } catch (e2) { flash('error', err(e2, 'Could not add that.')); }
    finally { setBusy(false); }
  };

  const addBulk = async () => {
    if (!bulk.trim()) return flash('error', 'Paste a list first.');
    setBusy(true);
    try {
      const r = await client.post('training/terms/bulk', { kind, text: bulk, company_id: companyId || undefined });
      flash('success', r.data.skipped
        ? `${r.data.added} added, ${r.data.skipped} were already on the list.`
        : `${r.data.added} added.`);
      setBulk('');
      load();
    } catch (e2) { flash('error', err(e2, 'Could not import that.')); }
    finally { setBusy(false); }
  };

  const remove = async (row) => {
    setBusy(true);
    try { await client.delete(`training/terms/${row.id}`); load(); }
    catch (e2) { flash('error', err(e2, 'Could not delete that.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PillTabs value={kind} onChange={setKind} items={[
        { key: 'name',    label: 'Customer names' },
        { key: 'vehicle', label: 'Extra makes & models' },
      ]} />

      {kind === 'vehicle' && (
        <Alert type="info" dismissible={false}>
          Makes and models already in the form builder show up in the Tool Kit automatically — you do not need to
          retype them. Add here only the ones the vehicle catalog does not carry.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel tone="inset" radius="xl" pad="lg">
          <SectionHeader level="sub" icon={Plus} title="Add one" />
          <form onSubmit={addOne} className="space-y-3">
            <Field label="Word" required>
              <input value={one.term} onChange={(e) => setOne(o => ({ ...o, term: e.target.value }))}
                className="input text-sm py-2 w-full"
                placeholder={kind === 'name' ? 'Siobhan' : 'Peugeot'} />
            </Field>
            <Field label="How to say it" hint="Optional. Overrides the automatic syllable split on the card.">
              <input value={one.phonetic} onChange={(e) => setOne(o => ({ ...o, phonetic: e.target.value }))}
                className="input text-sm py-2 w-full"
                placeholder={kind === 'name' ? 'shiv-AWN' : 'pu-ZHOH'} />
            </Field>
            <Field label="Note">
              <input value={one.note} onChange={(e) => setOne(o => ({ ...o, note: e.target.value }))}
                className="input text-sm py-2 w-full" />
            </Field>
            <Button type="submit" disabled={busy}><Plus size={14} className="mr-1.5" />Add</Button>
          </form>
        </Panel>

        <Panel tone="inset" radius="xl" pad="lg">
          <SectionHeader level="sub" icon={ListPlus} title="Paste a list" />
          <p className="text-[11px] m-0 mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            One per line, or separated by commas. Anything already on the list is skipped, so you can paste a
            longer version of the same file whenever it grows.
          </p>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={8}
            className="input text-sm py-2 w-full font-mono"
            placeholder={kind === 'name' ? 'Siobhan\nXochitl\nDubois' : 'Peugeot\nCitroen\nSkoda'} />
          <Button onClick={addBulk} disabled={busy} className="mt-3">
            <Upload size={14} className="mr-1.5" />{busy ? 'Importing…' : 'Import'}
          </Button>
        </Panel>
      </div>

      {loading ? <Loading variant="rows" rows={3} /> : (
        rows.length === 0
          ? <EmptyState icon={Volume2} compact title="Nothing on this list yet" />
          : (
            <Panel tone="surface" radius="xl" pad="md">
              <p className="text-[10px] font-bold uppercase tracking-wider m-0 mb-2"
                style={{ color: 'var(--color-text-secondary)' }}>
                {rows.length} on the list
              </p>
              <div className="flex flex-wrap gap-2">
                {rows.map(r => (
                  <span key={r.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold pl-2.5 pr-1 py-1 rounded-full"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                    {r.term}
                    {r.phonetic && (
                      <span className="font-mono font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                        {r.phonetic}
                      </span>
                    )}
                    <button onClick={() => remove(r)} disabled={busy} aria-label={`Remove ${r.term}`}
                      className="w-5 h-5 rounded-full flex items-center justify-center disabled:opacity-40"
                      style={{ color: 'var(--color-error-600)' }}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            </Panel>
          )
      )}
    </div>
  );
}

// ── Who is getting through it ────────────────────────────────────────────────
function ProgressPanel({ companyId }) {
  const [trainees, setTrainees] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const params = companyId ? `?company_id=${companyId}` : '';
    Promise.all([
      client.get(`training/trainees${params}`).then(r => r.data.trainees || []).catch(() => []),
      client.get(`training/progress${params}`).then(r => r.data.progress || []).catch(() => []),
    ]).then(([t, p]) => { if (!dead) { setTrainees(t); setRows(p); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [companyId]);

  // Everyone with progress, trainees first -- a promoted fronter who is still
  // working through the material should not vanish from the list the moment
  // their role changes.
  const people = useMemo(() => {
    const byUser = {};
    for (const t of trainees) {
      byUser[t.user_id] = {
        user_id: t.user_id, name: t.name, trainee: true,
        opened: t.opened, completed: t.completed, last: null,
      };
    }
    for (const p of rows) {
      const e = (byUser[p.user_id] ||= {
        user_id: p.user_id, name: p.user_name || p.user_id, trainee: false,
        opened: 0, completed: 0, last: null,
      });
      if (!e.trainee) { e.opened += 1; if (p.status === 'completed') e.completed += 1; }
      if (!e.last || p.updated_at > e.last) e.last = p.updated_at;
    }
    return Object.values(byUser).sort((a, b) =>
      (Number(b.trainee) - Number(a.trainee)) || (b.completed - a.completed) || a.name.localeCompare(b.name));
  }, [trainees, rows]);

  if (loading) return <Loading variant="rows" rows={4} label="Loading progress" />;
  if (!people.length) {
    return <EmptyState icon={BarChart3} title="Nobody has opened anything yet"
      hint="Progress appears here as soon as a trainee opens a document, listens to a call or answers a scenario." />;
  }

  const a = accent('success');
  return (
    <div className="space-y-2">
      {people.map(p => (
        <div key={p.user_id} className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: p.trainee ? a.soft : 'var(--color-bg-secondary)' }}>
            <GraduationCap size={16} style={{ color: p.trainee ? a.fg : 'var(--color-text-tertiary)' }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>
              {p.name}
              {p.trainee && (
                <span className="text-[10px] font-bold uppercase tracking-wider ml-2 px-2 py-0.5 rounded-full"
                  style={{ background: a.soft, color: a.fg }}>trainee</span>
              )}
            </p>
            <p className="text-[11px] m-0" style={{ color: 'var(--color-text-secondary)' }}>
              {p.opened} opened · {p.completed} finished
              {p.last ? ` · last ${new Date(p.last).toLocaleDateString()}` : ''}
            </p>
          </div>
          {p.completed > 0 && (
            <span className="flex items-center gap-1 text-xs font-bold flex-shrink-0" style={{ color: a.fg }}>
              <CheckCircle2 size={14} /> {p.completed}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── the manage surface ───────────────────────────────────────────────────────
export default function TrainingManager({ companyId, canProgress }) {
  const [tab, setTab] = useState('documents');
  const { msg, flash, clear } = useFlash();

  const tabs = [
    { key: 'documents',  label: 'Documents',  icon: BookOpen },
    { key: 'recordings', label: 'Recordings', icon: Headphones },
    { key: 'scenarios',  label: 'Scenarios',  icon: MessageSquareWarning },
    { key: 'toolkit',    label: 'Tool Kit',   icon: Volume2 },
    ...(canProgress ? [{ key: 'progress', label: 'Progress', icon: BarChart3 }] : []),
  ];

  return (
    <div className="space-y-4">
      <PillTabs items={tabs} value={tab} onChange={(k) => { clear(); setTab(k); }} />
      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      {tab === 'documents'  && <MediaManager kind="document"  companyId={companyId} flash={flash} />}
      {tab === 'recordings' && <MediaManager kind="recording" companyId={companyId} flash={flash} />}
      {tab === 'scenarios'  && <ScenarioManager companyId={companyId} flash={flash} />}
      {tab === 'toolkit'    && <TermManager companyId={companyId} flash={flash} />}
      {tab === 'progress' && canProgress && <ProgressPanel companyId={companyId} />}
    </div>
  );
}
