// ScratchpadSection — who gets the private spreadsheet and notepad.
//
// ACCESS HAS TWO LAYERS, the same shape as Customer Lookup so a superadmin
// does not have to learn a second mental model: "everyone gets it" is one
// write that covers the estate, and a person's own switch overrides it in
// either direction. A switch that merely matches the default SAYS SO, because
// "on for everyone" must never read the same as "deliberately on for this
// person" — otherwise turning the default off later looks like it did nothing.
//
// The one difference from Customer Lookup is the shipped default: BOTH ON.
// That tool reaches a paid third party and leaks PII, so it ships off. This is
// a private notepad that reads no customer data and calls nothing, so shipping
// it off would just mean granting it by hand sixty times to reach the obvious
// answer.
import { useState, useEffect, useCallback } from 'react';
import { Table2, NotebookPen, Users } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { Panel, SectionHeader, Loading, Toggle, useFlash } from '../../UI/kit';

const SWITCHES = [
  {
    key: 'sheet',
    icon: Table2,
    label: 'Private spreadsheet',
    hint: 'A full spreadsheet in the header — formulas, multiple sheets, copy and paste from Excel. Saved to their account only; nobody else can open it.',
  },
  {
    key: 'note',
    icon: NotebookPen,
    label: 'Private notepad',
    hint: 'A plain-text scratch pad in the same panel. Autosaves as they type, and is visible only to them.',
  },
];

export default function ScratchpadSection({ account }) {
  const userId = account?.user_id || account?.id || null;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [defaults, setDefaults] = useState({ sheet: true, note: true });
  const [explicit, setExplicit] = useState({});
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await client.get(`scratchpad/admin/${userId}`);
      setDefaults(r.data.defaults || { sheet: true, note: true });
      setExplicit(r.data.explicit || {});
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not load scratchpad access.');
    } finally {
      setLoading(false);
    }
  }, [userId, flash]);

  useEffect(() => { load(); }, [load]);

  // Effective = their own switch when they have one, else the estate default.
  const effective = (key) => (explicit[key] === undefined ? !!defaults[key] : !!explicit[key]);

  const toggleUser = async (key) => {
    const next = !effective(key);
    setBusy(key);
    try {
      const r = await client.put(`scratchpad/admin/${userId}`, { [key]: next });
      setDefaults(r.data.defaults || defaults);
      // The server drops a row that stops saying anything the default does not
      // already say, so read it back rather than assuming this stayed explicit.
      const row = r.data.row || {};
      setExplicit(Object.fromEntries(
        SWITCHES.map(s => s.key).filter(k => row[k] !== undefined).map(k => [k, !!row[k]]),
      ));
      const what = SWITCHES.find(s => s.key === key)?.label || key;
      flash('success', next
        ? `${what} is on for this user.`
        : `${what} is off for this user${defaults[key] ? ', even though everyone else has it' : ''}.`);
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not save that switch.');
    } finally { setBusy(null); }
  };

  const toggleDefault = async (key) => {
    const next = !defaults[key];
    setBusy(`d:${key}`);
    try {
      const r = await client.put('scratchpad/admin/defaults', { [key]: next });
      setDefaults(r.data.defaults || { ...defaults, [key]: next });
      const what = SWITCHES.find(s => s.key === key)?.label || key;
      flash('success', next
        ? `${what} is now on for everyone without a switch of their own.`
        : `${what} is now off for everyone without a switch of their own.`);
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not change what everyone gets.');
    } finally { setBusy(null); }
  };

  if (loading) return <Loading variant="cards" />;

  return (
    <div className="space-y-3">
      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      <Panel>
        <SectionHeader level="section" icon={Users} title="Everyone"
          subtitle="What every account gets unless the person below is set differently." />
        <div className="space-y-2">
          {SWITCHES.map(s => (
            <Toggle key={s.key}
              checked={!!defaults[s.key]}
              disabled={busy === `d:${s.key}`}
              onChange={() => toggleDefault(s.key)}
              label={s.label}
              hint={s.hint} />
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionHeader level="section" title="This user"
          subtitle="Overrides the estate default in either direction." />
        <div className="space-y-2">
          {SWITCHES.map(s => {
            const own = explicit[s.key] !== undefined;
            return (
              <Toggle key={s.key}
                checked={effective(s.key)}
                disabled={busy === s.key}
                onChange={() => toggleUser(s.key)}
                label={s.label}
                hint={own
                  ? `Set for this user${!!explicit[s.key] === !!defaults[s.key] ? ' — same as everyone' : ' — different from everyone'}.`
                  : `Following the default (${defaults[s.key] ? 'on' : 'off'} for everyone).`} />
            );
          })}
        </div>
      </Panel>

      <Panel tone="inset">
        <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          The scratchpad is private: one spreadsheet and one notepad per person, stored against
          their account and visible to nobody else — not to a manager, not to compliance, not in
          any report. A read-only admin never gets it. Documents are capped at 1&nbsp;MB each.
        </p>
      </Panel>
    </div>
  );
}
