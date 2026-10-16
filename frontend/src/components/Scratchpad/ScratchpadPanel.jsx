import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Table2, NotebookPen, Loader2, Check, AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import client from '../../api/client';

// ============================================================================
// ScratchpadPanel — the private spreadsheet + notepad, in one overlay.
//
// WHY THE SPREADSHEET LIBRARY IS NOT IMPORTED AT THE TOP OF THIS FILE.
// x-data-spreadsheet is ~1.4 MB on disk and it is the single biggest thing
// this feature adds. A static import would put it in a shared chunk that every
// user downloads on every cold load whether or not they ever open a sheet —
// the opposite of what was asked for. It is `await import(...)`ed the first
// time the Sheet tab is actually shown, once per session, and the CSS comes
// with it. Everything else here is a textarea.
//
// SAVING IS DEBOUNCED AND LAST-WRITE-WINS. This is one person's own scratch
// document, not a shared record: there is no second editor to conflict with,
// so a 1.5 s debounce and a whole-document PUT is the honest design. The save
// state is SHOWN rather than hidden, because silent autosave on something
// people paste real work into is how work gets lost without anyone noticing.
// ============================================================================

const SAVE_DEBOUNCE_MS = 1500;

// x-spreadsheet's own empty document. Handing it `null` makes it render a
// sheet it will not then return from getData(), so the first save would write
// an empty document over whatever the user had just typed.
const EMPTY_SHEET = [{ name: 'Sheet1', rows: {} }];

function SaveState({ state, error }) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--color-error-600)' }}>
        <AlertTriangle size={12} />{error}
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <Loader2 size={12} className="animate-spin" />Saving…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-success-600)' }}>
        <Check size={12} />Saved
      </span>
    );
  }
  return null;
}

export default function ScratchpadPanel({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [access, setAccess] = useState({ sheet: false, note: false });
  const [tab, setTab] = useState('sheet');
  const [big, setBig] = useState(false);

  const [note, setNote] = useState('');
  const [saveState, setSaveState] = useState({ sheet: null, note: null });
  const [saveError, setSaveError] = useState({ sheet: null, note: null });

  const sheetHostRef = useRef(null);     // the div x-spreadsheet mounts into
  const sheetApiRef = useRef(null);      // the Spreadsheet instance
  const sheetDataRef = useRef(null);     // loaded data, held until the lib is up
  const timers = useRef({ sheet: null, note: null });
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    clearTimeout(timers.current.sheet);
    clearTimeout(timers.current.note);
  }, []);

  // ── one request opens the whole thing ────────────────────────────────────
  useEffect(() => {
    let dead = false;
    client.get('scratchpad')
      .then(r => {
        if (dead) return;
        const a = r.data.access || { sheet: false, note: false };
        setAccess(a);
        setNote(typeof r.data.note?.text === 'string' ? r.data.note.text : '');
        sheetDataRef.current = Array.isArray(r.data.sheet) && r.data.sheet.length ? r.data.sheet : EMPTY_SHEET;
        setTab(a.sheet ? 'sheet' : 'note');     // open on whichever they have
        setLoading(false);
      })
      .catch(e => {
        if (dead) return;
        setLoadError(e.response?.data?.error || 'Could not open your scratchpad');
        setLoading(false);
      });
    return () => { dead = true; };
  }, []);

  const save = useCallback(async (kind, data) => {
    setSaveState(s => ({ ...s, [kind]: 'saving' }));
    setSaveError(s => ({ ...s, [kind]: null }));
    try {
      await client.put(`scratchpad/${kind}`, { data });
      if (!mounted.current) return;
      setSaveState(s => ({ ...s, [kind]: 'saved' }));
      setTimeout(() => {
        if (mounted.current) setSaveState(s => (s[kind] === 'saved' ? { ...s, [kind]: null } : s));
      }, 2000);
    } catch (e) {
      if (!mounted.current) return;
      setSaveState(s => ({ ...s, [kind]: null }));
      setSaveError(s => ({ ...s, [kind]: e.response?.data?.error || 'Could not save' }));
    }
  }, []);

  const queueSave = useCallback((kind, data) => {
    clearTimeout(timers.current[kind]);
    timers.current[kind] = setTimeout(() => save(kind, data), SAVE_DEBOUNCE_MS);
  }, [save]);

  // ── the spreadsheet, loaded on first sight of its tab ────────────────────
  useEffect(() => {
    if (loading || tab !== 'sheet' || !access.sheet) return;
    if (sheetApiRef.current || !sheetHostRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const [{ default: Spreadsheet }] = await Promise.all([
          import('x-data-spreadsheet'),
          import('x-data-spreadsheet/dist/xspreadsheet.css'),
        ]);
        if (cancelled || !sheetHostRef.current || sheetApiRef.current) return;
        const api = new Spreadsheet(sheetHostRef.current, {
          mode: 'edit',
          showToolbar: true,
          showGrid: true,
          showContextmenu: true,
          view: {
            height: () => sheetHostRef.current?.clientHeight || 480,
            width: () => sheetHostRef.current?.clientWidth || 800,
          },
          // 1000 rows (x-spreadsheet ships 100). This costs nothing at rest:
          // only cells that actually hold something are stored or sent — an
          // empty row is absent from getData(), not a row of nulls — so the
          // grid gets bigger without the document getting bigger.
          row: { len: 1000, height: 25 },
        });
        api.loadData(sheetDataRef.current || EMPTY_SHEET);
        // change() fires on every edit; getData() is the whole document.
        api.change(() => queueSave('sheet', api.getData()));
        sheetApiRef.current = api;
      } catch {
        if (!cancelled) setSaveError(s => ({ ...s, sheet: 'The spreadsheet failed to load.' }));
      }
    })();
    return () => { cancelled = true; };
  }, [loading, tab, access.sheet, queueSave]);

  // x-spreadsheet measures once at construction, so the expand toggle has to
  // tell it. It exposes no re-measure, and rebuilding it would drop edits not
  // yet flushed — dispatching the resize it already listens for is the one
  // safe lever.
  useEffect(() => {
    if (!sheetApiRef.current) return;
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(t);
  }, [big, tab]);

  const onNoteChange = (v) => {
    setNote(v);
    queueSave('note', { text: v });
  };

  const close = () => {
    // Flush what is still waiting rather than losing the last keystrokes.
    clearTimeout(timers.current.note);
    clearTimeout(timers.current.sheet);
    if (access.note) save('note', { text: note });
    if (sheetApiRef.current) save('sheet', sheetApiRef.current.getData());
    onClose?.();
  };

  const Tab = ({ id, icon: Icon, label, show }) => (show ? (
    <button type="button" onClick={() => setTab(id)}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
      style={tab === id
        ? { background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }
        : { background: 'transparent', color: 'var(--color-text-secondary)' }}>
      <Icon size={13} />{label}
    </button>
  ) : null);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex flex-col rounded-2xl overflow-hidden w-full"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl)',
          maxWidth: big ? '100%' : 1180,
          height: big ? '100%' : 'min(86vh, 760px)',
        }}>

        {/* header */}
        <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center gap-1">
            <Tab id="sheet" icon={Table2} label="Spreadsheet" show={access.sheet} />
            <Tab id="note" icon={NotebookPen} label="Notepad" show={access.note} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SaveState state={saveState[tab]} error={saveError[tab]} />
            <button type="button" onClick={() => setBig(b => !b)} title={big ? 'Shrink' : 'Expand'}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ color: 'var(--color-text-secondary)' }}>
              {big ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button type="button" onClick={close} title="Close"
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ color: 'var(--color-text-secondary)' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 min-h-0 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
          )}

          {!loading && loadError && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <p className="text-sm m-0" style={{ color: 'var(--color-error-600)' }}>{loadError}</p>
            </div>
          )}

          {!loading && !loadError && !access.sheet && !access.note && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <p className="text-sm m-0" style={{ color: 'var(--color-text-secondary)' }}>
                Your scratchpad is switched off for this account.
              </p>
            </div>
          )}

          {/* The sheet host stays MOUNTED once created and is hidden rather
              than unmounted on a tab switch: x-spreadsheet owns its own DOM,
              and tearing it down would drop whatever had not been flushed in
              the last second and a half. */}
          {!loading && !loadError && access.sheet && (
            <div ref={sheetHostRef}
              style={{ position: 'absolute', inset: 0, display: tab === 'sheet' ? 'block' : 'none', overflow: 'hidden' }} />
          )}

          {!loading && !loadError && access.note && tab === 'note' && (
            <textarea
              value={note}
              onChange={e => onNoteChange(e.target.value)}
              placeholder="Your private notes — saved automatically, visible only to you."
              spellCheck
              className="absolute inset-0 w-full h-full p-4 text-sm"
              style={{
                background: 'var(--color-bg)', color: 'var(--color-text)',
                border: 0, outline: 'none', resize: 'none', lineHeight: 1.6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              }} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
