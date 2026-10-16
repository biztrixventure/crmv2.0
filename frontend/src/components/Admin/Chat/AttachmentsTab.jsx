import { useEffect, useState, useCallback } from 'react';
import { Paperclip, Clock, HardDrive, Save } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading } from '../../UI/kit';
import { Button, Alert } from '../../UI';

// AttachmentsTab — how big a shared file may be, and how long it survives.
//
// ONE SCREEN FOR CHAT AND EMAIL. They write to two buckets but share one
// upload path and one storage bill, so capping chat alone would just move the
// problem. Both settings are estate-wide.
//
// THE SIZE CAP IS WHY FILES "WOULD NOT UPLOAD". It was a constant of 10 MB in
// two route files. Measured 2026-10-16: the largest attachment ever stored is
// 9.875 MB — the pipeline works right up to the wall and then refuses, with an
// error people read as the feature being broken.
//
// The ceiling on the ceiling is real, not timidity: a file travels base64
// inside a JSON body (+33%), so the server's body-parser limit has to move
// with it. `max_settable_mb` is what that limit was actually raised to, and
// the input refuses to go past it rather than letting an admin set a number
// that produces an unexplained 413.
const PRESET_HOURS = [
  { v: 24,  label: '24 hours' },
  { v: 72,  label: '3 days' },
  { v: 168, label: '7 days' },
  { v: 720, label: '30 days' },
  { v: 0,   label: 'Keep forever' },
];

export default function AttachmentsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [cfg, setCfg]     = useState({ max_mb: 25, retention_hours: 24, max_settable_mb: 25, pending_purge: 0 });
  const [draft, setDraft] = useState({ max_mb: 25, retention_hours: 24 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('chat/admin/attachment-settings');
      setCfg(r.data);
      setDraft({ max_mb: r.data.max_mb, retention_hours: r.data.retention_hours });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not load attachment settings');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = draft.max_mb !== cfg.max_mb || draft.retention_hours !== cfg.retention_hours;

  const save = async () => {
    setSaving(true);
    try {
      const r = await client.put('chat/admin/attachment-settings', draft);
      setCfg(r.data);
      setDraft({ max_mb: r.data.max_mb, retention_hours: r.data.retention_hours });
      toast.success('Attachment settings saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  if (loading) return <Loading variant="cards" />;

  return (
    <div className="space-y-3">
      <Panel>
        <SectionHeader level="section" icon={HardDrive} title="Maximum file size"
          subtitle="Applies to chat and email attachments alike. Anything larger is refused at upload, with this number in the message." />

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}>Megabytes per file</label>
            <input type="number" min={1} max={cfg.max_settable_mb} className="input" style={{ width: 120 }}
              value={draft.max_mb}
              onChange={e => setDraft(d => ({ ...d, max_mb: e.target.value === '' ? '' : Number(e.target.value) }))} />
          </div>
          <p className="text-[11px] m-0 pb-2 flex-1 min-w-[240px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Up to {cfg.max_settable_mb} MB. Files are sent base64-encoded, which adds about a third,
            so going beyond this needs the server's request limit raised too.
          </p>
        </div>
      </Panel>

      <Panel>
        <SectionHeader level="section" icon={Clock} title="How long attachments are kept"
          subtitle="After this, the file itself is deleted from storage. The message and the file's name stay, marked expired, so the conversation still reads." />

        <div className="flex flex-wrap gap-1.5">
          {PRESET_HOURS.map(p => {
            const on = Number(draft.retention_hours) === p.v;
            return (
              <button key={p.v} type="button"
                onClick={() => setDraft(d => ({ ...d, retention_hours: p.v }))}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                style={on
                  ? { background: 'var(--gradient-sidebar)', color: '#fff' }
                  : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* RETENTION IS RETROACTIVE. Switching it on does not only govern the
            next upload — every file already older than the window goes on the
            next sweep. That number has to be on screen before the save, not
            discovered afterwards from an empty conversation. */}
        {cfg.retention_hours > 0 && cfg.pending_purge > 0 && (
          <div className="mt-3">
            <Alert type="warning" dismissible={false}>
              <strong>{cfg.pending_purge.toLocaleString()}</strong> already-shared{' '}
              {cfg.pending_purge === 1 ? 'message or email is' : 'messages and emails are'} older
              than {cfg.retention_hours} hours. Their files will be deleted on the next hourly
              sweeps — the messages stay, the attachments are gone and cannot be recovered.
              Choose <em>Keep forever</em> if that is not what you want.
            </Alert>
          </div>
        )}

        {Number(draft.retention_hours) === 0 && (
          <div className="mt-3">
            <Alert type="warning" dismissible={false}>
              Nothing will ever be deleted. Every file shared in chat or email stays in storage
              permanently, and the bill grows with it.
            </Alert>
          </div>
        )}
      </Panel>

      <Panel tone="inset">
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={save} disabled={!dirty || saving || draft.max_mb === ''}>
            <Save size={14} className="mr-1.5" />{saving ? 'Saving…' : 'Save settings'}
          </Button>
          <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            <Paperclip size={11} className="inline mr-1" />
            Currently {cfg.max_mb} MB per file,{' '}
            {cfg.retention_hours
              ? `deleted after ${cfg.retention_hours} hour${cfg.retention_hours === 1 ? '' : 's'}`
              : 'kept forever'}. The size change applies to the next upload; expiry is swept hourly.
          </p>
        </div>
      </Panel>
    </div>
  );
}
