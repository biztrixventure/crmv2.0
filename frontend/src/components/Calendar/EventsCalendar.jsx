import { useState, useEffect, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { toast } from 'sonner';
import {
  CalendarDays, Plus, X, Trash2, Clock, MapPin, AlignLeft, Loader2, Lock,
} from 'lucide-react';
import client from '../../api/client';
import './EventsCalendar.css';

const COLORS = [
  { hex: '#a8885c', name: 'Gold' },
  { hex: '#2563eb', name: 'Blue' },
  { hex: '#16a34a', name: 'Green' },
  { hex: '#dc2626', name: 'Red' },
  { hex: '#d97706', name: 'Amber' },
  { hex: '#7c3aed', name: 'Violet' },
  { hex: '#0891b2', name: 'Cyan' },
  { hex: '#db2777', name: 'Pink' },
];

const pad = (n) => String(n).padStart(2, '0');

// ISO → value for <input type="date|datetime-local"> in the viewer's local tz.
function toLocalInput(iso, dateOnly) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dateOnly ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Local input value → UTC ISO string for storage.
function toISO(localStr, dateOnly) {
  if (!localStr) return null;
  const d = dateOnly ? new Date(`${localStr}T00:00:00`) : new Date(localStr);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtRange(ev) {
  if (!ev.starts_at) return '';
  const start = new Date(ev.starts_at);
  const end = ev.ends_at ? new Date(ev.ends_at) : null;
  const dateOpts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  if (ev.all_day) {
    const s = start.toLocaleDateString(undefined, dateOpts);
    if (!end) return `${s} · All day`;
    const e = end.toLocaleDateString(undefined, dateOpts);
    return s === e ? `${s} · All day` : `${s} → ${e} · All day`;
  }
  const s = `${start.toLocaleDateString(undefined, dateOpts)}, ${start.toLocaleTimeString(undefined, timeOpts)}`;
  if (!end) return s;
  const sameDay = start.toDateString() === end.toDateString();
  const e = sameDay
    ? end.toLocaleTimeString(undefined, timeOpts)
    : `${end.toLocaleDateString(undefined, dateOpts)}, ${end.toLocaleTimeString(undefined, timeOpts)}`;
  return `${s} → ${e}`;
}

const EMPTY = { title: '', description: '', location: '', all_day: false, color: COLORS[0].hex };

// ── Event create / edit / view modal ──────────────────────────────────────────
const EventModal = ({ open, mode, draft, onChange, onClose, onSave, onDelete, saving, canEdit }) => {
  if (!open) return null;
  const readOnly = !canEdit;
  const dateOnly = !!draft.all_day;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden animate-fade-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg, 0 20px 50px rgba(0,0,0,0.3))' }}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5 text-white">
            <CalendarDays size={20} />
            <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {readOnly ? 'Event Details' : mode === 'edit' ? 'Edit Event' : 'New Event'}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {readOnly ? (
            <>
              <div className="flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: draft.color }} />
                <h4 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{draft.title}</h4>
              </div>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <Clock size={15} /> {fmtRange(draft)}
              </div>
              {draft.location && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <MapPin size={15} /> {draft.location}
                </div>
              )}
              {draft.description && (
                <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <AlignLeft size={15} className="mt-0.5 flex-shrink-0" />
                  <p className="whitespace-pre-wrap">{draft.description}</p>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs pt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                <Lock size={12} /> Read-only — only administrators can edit events.
              </div>
            </>
          ) : (
            <>
              <Field label="Title">
                <input autoFocus value={draft.title} onChange={(e) => onChange({ title: e.target.value })}
                  placeholder="Team meeting, holiday, deadline…" className="ec-input" />
              </Field>

              <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={draft.all_day}
                  onChange={(e) => onChange({ all_day: e.target.checked })} className="w-4 h-4 accent-[var(--color-primary-600,#a8885c)]" />
                All-day event
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Starts">
                  <input type={dateOnly ? 'date' : 'datetime-local'} value={draft.startLocal || ''}
                    onChange={(e) => onChange({ startLocal: e.target.value })} className="ec-input" />
                </Field>
                <Field label="Ends (optional)">
                  <input type={dateOnly ? 'date' : 'datetime-local'} value={draft.endLocal || ''}
                    onChange={(e) => onChange({ endLocal: e.target.value })} className="ec-input" />
                </Field>
              </div>

              <Field label="Location (optional)">
                <input value={draft.location} onChange={(e) => onChange({ location: e.target.value })}
                  placeholder="Office, Zoom link, address…" className="ec-input" />
              </Field>

              <Field label="Description (optional)">
                <textarea rows={3} value={draft.description} onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="Details, agenda, notes…" className="ec-input resize-none" />
              </Field>

              <Field label="Colour">
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button key={c.hex} type="button" title={c.name} onClick={() => onChange({ color: c.hex })}
                      className="w-8 h-8 rounded-lg transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c.hex,
                        boxShadow: draft.color === c.hex ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c.hex}` : 'none',
                      }} />
                  ))}
                </div>
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between gap-3"
          style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {canEdit && mode === 'edit' ? (
            <button onClick={onDelete} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }}>
              <Trash2 size={15} /> Delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {canEdit && (
              <button onClick={onSave} disabled={saving || !draft.title?.trim() || !draft.startLocal}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                {mode === 'edit' ? 'Save changes' : 'Create event'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-bold uppercase tracking-wide mb-1.5"
      style={{ color: 'var(--color-text-tertiary)' }}>{label}</label>
    {children}
  </div>
);

// ── Main calendar ──────────────────────────────────────────────────────────────
const EventsCalendar = ({ canEdit = false }) => {
  const calRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState({ open: false, mode: 'create', draft: {} });
  const rangeRef = useRef({ start: null, end: null });

  const load = useCallback(async () => {
    const { start, end } = rangeRef.current;
    setLoading(true);
    try {
      const params = {};
      if (start) params.start = start;
      if (end) params.end = end;
      const res = await client.get('events', { params });
      setEvents(res.data.events || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  // FullCalendar emits the visible window whenever the view/date changes.
  const handleDatesSet = useCallback((arg) => {
    rangeRef.current = { start: arg.startStr, end: arg.endStr };
    load();
  }, [load]);

  const fcEvents = events.map((e) => ({
    id: String(e.id),
    title: e.title,
    start: e.starts_at,
    end: e.ends_at || undefined,
    allDay: e.all_day,
    backgroundColor: e.color,
    borderColor: e.color,
    extendedProps: { raw: e },
  }));

  const openCreate = (startLocal = '', endLocal = '', allDay = false) => {
    setModal({
      open: true, mode: 'create',
      draft: { ...EMPTY, all_day: allDay, startLocal, endLocal },
    });
  };

  const openEditOrView = (raw) => {
    setModal({
      open: true, mode: 'edit',
      draft: {
        ...raw,
        startLocal: toLocalInput(raw.starts_at, raw.all_day),
        endLocal: toLocalInput(raw.ends_at, raw.all_day),
      },
    });
  };

  // Selecting a range / clicking a day (edit mode only).
  const handleSelect = (info) => {
    if (!canEdit) return;
    if (info.allDay) {
      // FullCalendar emits date-only strings here; use them verbatim (parsing via
      // Date would shift the day in non-UTC zones). End is exclusive — leave blank
      // so a single-day pick doesn't pre-fill the following midnight.
      openCreate(info.startStr.slice(0, 10), '', true);
    } else {
      openCreate(toLocalInput(info.startStr, false), toLocalInput(info.endStr, false), false);
    }
    calRef.current?.getApi().unselect();
  };

  const handleEventClick = (info) => {
    openEditOrView(info.event.extendedProps.raw);
  };

  // Drag / resize — persist new dates, revert on failure.
  const handleEventChange = async (info) => {
    if (!canEdit) { info.revert(); return; }
    const ev = info.event;
    try {
      await client.put(`events/${ev.id}`, {
        starts_at: ev.start?.toISOString(),
        ends_at: ev.end ? ev.end.toISOString() : null,
        all_day: ev.allDay,
      });
      setEvents((prev) => prev.map((e) =>
        String(e.id) === ev.id
          ? { ...e, starts_at: ev.start?.toISOString(), ends_at: ev.end ? ev.end.toISOString() : null, all_day: ev.allDay }
          : e));
      toast.success('Event updated');
    } catch (err) {
      info.revert();
      toast.error(err.response?.data?.error || 'Could not move event');
    }
  };

  const onModalChange = (patch) => setModal((m) => ({ ...m, draft: { ...m.draft, ...patch } }));

  const handleSave = async () => {
    const d = modal.draft;
    const starts_at = toISO(d.startLocal, d.all_day);
    if (!d.title?.trim() || !starts_at) { toast.error('Title and start time are required'); return; }
    const ends_at = toISO(d.endLocal, d.all_day);
    if (ends_at && new Date(ends_at) < new Date(starts_at)) { toast.error('End time is before the start time'); return; }

    const payload = {
      title: d.title.trim(), description: d.description || null, location: d.location || null,
      starts_at, ends_at, all_day: !!d.all_day, color: d.color || COLORS[0].hex,
    };

    setSaving(true);
    try {
      if (modal.mode === 'edit') {
        await client.put(`events/${d.id}`, payload);
        toast.success('Event updated');
      } else {
        await client.post('events', payload);
        toast.success('Event created');
      }
      setModal({ open: false, mode: 'create', draft: {} });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    setSaving(true);
    try {
      await client.delete(`events/${modal.draft.id}`);
      toast.success('Event deleted');
      setModal({ open: false, mode: 'create', draft: {} });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Hero header */}
      <div className="rounded-2xl p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.12))' }}>
        <div className="flex items-center gap-3 text-white">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <CalendarDays size={26} />
          </div>
          <div>
            <h2 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Event Calendar
            </h2>
            <p className="text-sm text-white/80">
              {canEdit ? 'Create, drag, and manage company events.' : 'Company events & important dates.'}
            </p>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => openCreate()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.03] self-start sm:self-auto"
            style={{ backgroundColor: 'white', color: 'var(--color-primary-700, #6b5436)' }}>
            <Plus size={17} /> New Event
          </button>
        )}
      </div>

      {/* Calendar card */}
      <div className="biztrix-calendar rounded-2xl p-3 sm:p-5 relative"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        {loading && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        )}
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'List' }}
          height="auto"
          nowIndicator
          dayMaxEvents={3}
          weekends
          events={fcEvents}
          editable={canEdit}
          selectable={canEdit}
          selectMirror={canEdit}
          eventDrop={handleEventChange}
          eventResize={handleEventChange}
          select={handleSelect}
          eventClick={handleEventClick}
          datesSet={handleDatesSet}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        />
      </div>

      <EventModal
        open={modal.open}
        mode={modal.mode}
        draft={modal.draft}
        canEdit={canEdit}
        saving={saving}
        onChange={onModalChange}
        onClose={() => setModal({ open: false, mode: 'create', draft: {} })}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
};

export default EventsCalendar;
