// ============================================================================
// CustomerLookupPanel — the staff "Customer Lookup" tool.
//
// Two jobs, each behind its own per-user switch (both default OFF, granted in
// User Control Center → Customer Lookup):
//   People   — a phone (optionally narrowed by name), or a free-text name
//              search, returns the profile: names, age, phones, addresses,
//              relatives, property.
//   Vehicles — vehicles seen at an address. The address can be typed, or
//              resolved from a name/phone (the server returns ONLY addresses
//              for that, so a vehicles-only user never sees a people profile).
//
// The ZIP box is checked against the CRM's existing /zipcode route
// (zippopotam.us, 24h cached) so the searcher sees the city/state they are
// actually searching before they spend a lookup on a typo.
//
// Nothing is stored. Every result here is fetched, shown, and forgotten.
// ============================================================================
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Search, Phone, User, MapPin, Car, Loader2, Copy, Check, Home, Users2,
  Mail, Building2, Hash, ChevronRight, Info, AlertTriangle, Database, CalendarClock, RefreshCw,
} from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, EmptyState, Field, PillTabs, Toggle, Loading } from '../UI/kit';
import { Badge, Alert, Button } from '../UI';

// ── helpers ──────────────────────────────────────────────────────────────────
const digits = (s) => String(s || '').replace(/\D/g, '');
const fmtPhone = (v) => {
  const d = digits(v);
  const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : (v || '');
};
const errText = (e, fallback) => e?.response?.data?.error || fallback;

// People paste the whole thing — "7307 Independence Way, San Antonio, TX 78223
// 4870". The service matches a street, so split it here instead of sending the
// city and state along and quietly missing. Only fires once the value actually
// LOOKS complete (state + 5-digit ZIP at the end), so it never fights typing.
function splitFullAddress(v) {
  const str = String(v || '').trim();
  if (!str.includes(',')) return null;
  const parts = str.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const m = parts[parts.length - 1].match(/^([A-Za-z]{2})\s+(\d{5})(?:[-\s]\d{4})?$/);
  if (!m) return null;
  return { street: parts.slice(0, Math.max(1, parts.length - 2)).join(', '), zip: m[2] };
}

// The service answers /lookup as { result } and /search as { results:[{data}] }.
// Flatten either into one list of person objects, most complete first.
function peopleFrom(data) {
  const roots = [];
  if (data?.person) roots.push(data.person);      // /enrich
  if (data?.result) roots.push(data.result);
  for (const r of (data?.results || [])) if (r?.data) roots.push(r.data);
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    const list = (root.people && root.people.length) ? root.people : [root];
    for (const p of list) {
      const k = p.detail_url || `${p.name}|${p.age}`;
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      out.push(p);
    }
  }
  return { people: out, merged: roots[0] || null };
}

function CopyBtn({ value, label }) {
  const [done, setDone] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  if (!value) return null;
  return (
    <button type="button" title={label || 'Copy'}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(String(value)).catch(() => {});
        setDone(true); clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1400);
      }}
      className="inline-flex items-center justify-center rounded p-1 transition-colors flex-shrink-0"
      style={{ color: done ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

// A labelled row inside a detail card.
const Row = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-2.5 text-xs">
    <Icon size={13} className="flex-shrink-0 mt-px" style={{ color: 'var(--color-text-tertiary)' }} />
    <span className="w-24 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
    <span className="min-w-0 flex-1" style={{ color: 'var(--color-text)' }}>{children}</span>
  </div>
);

const Chip = ({ children, tone = 'muted' }) => (
  <span className="inline-flex items-center px-1.5 py-px rounded-md text-[11px] font-medium"
    style={{
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border)',
      color: tone === 'strong' ? 'var(--color-text)' : 'var(--color-text-secondary)',
    }}>{children}</span>
);

// ── person detail ────────────────────────────────────────────────────────────
function PersonCard({ person, merged, canVehicles, onVehicles }) {
  const p = person || {};
  const addr = p.current_address || {};
  const phones = p.phone_numbers || [];
  const others = p.other_numbers || [];
  const emails = p.emails || merged?.all_emails || [];
  const history = p.address_history || [];
  const rel = p.relatives || [];
  const prop = p.property_summary || {};
  const aka = p.also_known_as || [];

  return (
    <div className="space-y-4">
      {/* identity */}
      <Panel pad="md" radius="xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="m-0 text-lg font-bold leading-tight" style={{ color: 'var(--color-text)' }}>
              {p.name || 'Unknown name'}
            </h3>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {p.age && <Chip>Age {p.age}</Chip>}
              {addr.state && <Chip>{addr.city ? `${addr.city}, ` : ''}{addr.state}</Chip>}
              {aka.slice(0, 4).map(a => <Chip key={a}>{a}</Chip>)}
            </div>
          </div>
          {canVehicles && (addr.street || addr.full) && (
            <button type="button"
              onClick={() => onVehicles({ address: addr.street || addr.full, zip: digits(addr.zip).slice(0, 5), name: p.name })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Car size={13} /> Vehicles here
            </button>
          )}
        </div>

        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {(addr.full || addr.street) && (
            <Row icon={Home} label="Current">
              <span className="inline-flex items-start gap-1">
                <span>{addr.full || [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}</span>
                <CopyBtn value={addr.full || addr.street} label="Copy address" />
              </span>
            </Row>
          )}
          {emails.length > 0 && (
            <Row icon={Mail} label="Email">
              <span className="flex flex-wrap gap-1.5">{emails.map(e => <Chip key={e} tone="strong">{e}</Chip>)}</span>
            </Row>
          )}
          {rel.length > 0 && (
            <Row icon={Users2} label="Relatives">
              <span className="flex flex-wrap gap-1">{rel.slice(0, 12).map(r => <Chip key={r.name}>{r.name}</Chip>)}</span>
            </Row>
          )}
        </div>
      </Panel>

      {/* phones */}
      {(phones.length > 0 || others.length > 0) && (
        <Panel pad="md" radius="xl">
          <SectionHeader level="sub" icon={Phone} title="Phone numbers" />
          <div className="space-y-1.5">
            {phones.map((ph, i) => (
              <div key={`${ph.number}-${i}`} className="flex items-center gap-2 flex-wrap text-xs rounded-lg px-2.5 py-2"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <span className="font-mono font-semibold" style={{ color: 'var(--color-text)' }}>{fmtPhone(ph.number)}</span>
                <CopyBtn value={digits(ph.number)} label="Copy number" />
                {ph.type && <Badge variant={/wireless|mobile|cell/i.test(ph.type) ? 'success' : 'info'} size="sm">{ph.type}</Badge>}
                {ph.carrier && <span style={{ color: 'var(--color-text-secondary)' }}>{ph.carrier}</span>}
                {ph.last_reported && (
                  <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{ph.last_reported}</span>
                )}
              </div>
            ))}
            {others.length > 0 && (
              <div className="pt-1.5">
                <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  Also seen
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {others.map((o, i) => (
                    <span key={`${o.number}-${i}`} className="inline-flex items-center gap-1 px-1.5 py-px rounded-md text-[11px] font-mono"
                      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      {fmtPhone(o.number)}{o.year ? ` · ${o.year}` : ''}
                      <CopyBtn value={digits(o.number)} />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* addresses */}
      {history.length > 0 && (
        <Panel pad="md" radius="xl">
          <SectionHeader level="sub" icon={MapPin} title="Address history"
            actions={<span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{history.length}</span>} />
          <ul className="m-0 p-0 list-none space-y-1">
            {history.map((a, i) => (
              <li key={`${a}-${i}`} className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <span className="min-w-0 flex-1" style={{ color: 'var(--color-text-secondary)' }}>{a}</span>
                <CopyBtn value={a} label="Copy address" />
                {canVehicles && (
                  <button type="button" onClick={() => onVehicles({ addressFull: a, name: p.name })}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold flex-shrink-0"
                    style={{ color: 'var(--color-primary-600)' }}>
                    <Car size={11} /> Vehicles
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* property */}
      {Object.keys(prop).length > 0 && (
        <Panel pad="md" radius="xl">
          <SectionHeader level="sub" icon={Building2} title="Property at the current address" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(prop).map(([k, v]) => (
              <div key={k} className="rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <p className="m-0 text-[11px] uppercase tracking-wider leading-none" style={{ color: 'var(--color-text-tertiary)' }}>{k}</p>
                <p className="m-0 mt-1 text-xs font-semibold leading-none" style={{ color: 'var(--color-text)' }}>{String(v ?? '—')}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* everything matched on this search */}
      {merged && (merged.all_phones?.length > 1 || merged.all_names?.length > 1) && (
        <Panel pad="md" radius="xl" tone="inset">
          <SectionHeader level="sub" icon={Info} title="Everything matched on this search" />
          {merged.all_names?.length > 0 && (
            <div className="mb-2">
              <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Names</p>
              <div className="flex flex-wrap gap-1">{merged.all_names.slice(0, 24).map(n => <Chip key={n}>{n}</Chip>)}</div>
            </div>
          )}
          {merged.all_phones?.length > 0 && (
            <div>
              <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Numbers</p>
              <div className="flex flex-wrap gap-1">
                {merged.all_phones.map(n => (
                  <span key={n} className="inline-flex items-center gap-1 px-1.5 py-px rounded-md text-[11px] font-mono"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    {fmtPhone(n)}<CopyBtn value={digits(n)} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

// ── vehicles result ──────────────────────────────────────────────────────────
// The service's vehicle payload has no documented shape, so nothing here
// assumes one. Records are located wherever they live (a plain array, a wrapper
// like { list: [...] }, a map keyed by the vehicle, or a single object), the
// fields a vehicle actually has are promoted into a card, and anything left
// over is flattened into label/value pairs — a nested object becomes
// "Parent · Child" rows.
//
// The first version put the raw keys in a table and printed any nested value
// with JSON.stringify, so a payload that was one object, or objects with
// sub-objects, rendered as a wall of JSON. Nothing below ever stringifies a
// value for display.

const prettyKey = (k) => String(k)
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^./, c => c.toUpperCase());

// Flatten any value into ordered [label, value] pairs of printable scalars.
function flattenFields(value, prefix = '', out = []) {
  if (value === null || value === undefined || value === '') return out;
  if (Array.isArray(value)) {
    const scalars = value.filter(v => v !== null && v !== undefined && typeof v !== 'object' && String(v) !== '');
    if (scalars.length === value.length) {
      if (scalars.length) out.push([prefix || 'Values', scalars.join(', ')]);
    } else {
      value.forEach((v, i) => flattenFields(v, prefix ? `${prefix} ${i + 1}` : `Item ${i + 1}`, out));
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      flattenFields(v, prefix ? `${prefix} · ${prettyKey(k)}` : prettyKey(k), out);
    }
    return out;
  }
  if (typeof value === 'boolean') { out.push([prefix, value ? 'Yes' : 'No']); return out; }
  out.push([prefix, String(value)]);
  return out;
}

// Find the actual vehicle records inside whatever came back.
function vehicleRecords(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    if (!v.length) return [];
    return v.filter(x => x !== null && x !== undefined && x !== '')
      .map(x => (x && typeof x === 'object' ? x : { Vehicle: String(x) }));
  }
  if (typeof v === 'object') {
    // A wrapper around the real list: { list: [...] } / { vehicles: [...] }
    const arrKey = Object.keys(v).find(k => Array.isArray(v[k]) && v[k].length);
    if (arrKey) return vehicleRecords(v[arrKey]);
    // A map keyed by the vehicle itself: { "2015 Ford F-150": { … } }
    const vals = Object.values(v);
    if (vals.length && vals.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      return Object.entries(v).map(([k, rec]) => ({ Vehicle: k, ...rec }));
    }
    return [v];
  }
  return [{ Vehicle: String(v) }];
}

// Pull a known field out of a record whatever it happens to be called, and
// wherever it sits. Payloads nest as often as they are flat — { vehicle: {
// year, make }, owner: { name } } must still title itself "2020 Honda" rather
// than falling back to the VIN — so scalars are collected one level down too
// and remembered by path, which is what stops a promoted field being repeated
// in the details grid below.
const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const pathKey = (p) => p.join('.').toLowerCase();
const scalarText = (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const isScalar = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'object';

function collectScalars(rec) {
  const out = [];
  for (const [k, v] of Object.entries(rec)) {
    if (isScalar(v)) { out.push({ path: [k], key: k, value: scalarText(v) }); continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (isScalar(v2)) out.push({ path: [k, k2], key: k2, value: scalarText(v2) });
      }
    }
  }
  return out;
}

function pickFrom(scalars, names, usedPaths) {
  for (const want of names) {
    const hit = scalars.find(s => normKey(s.key) === want && !usedPaths.has(pathKey(s.path)));
    if (hit) return hit;
  }
  return null;
}

const FIELD_SETS = {
  year:    ['year', 'modelyear', 'vehicleyear', 'yr'],
  make:    ['make', 'manufacturer', 'vehiclemake', 'brand'],
  model:   ['model', 'vehiclemodel', 'modelname'],
  trim:    ['trim', 'series', 'style', 'bodystyle', 'body', 'vehicletype'],
  vin:     ['vin', 'vinnumber', 'vinno', 'serialnumber', 'serial'],
  plate:   ['plate', 'plateno', 'licenseplate', 'license', 'tag', 'tagnumber', 'registration'],
  color:   ['color', 'colour', 'exteriorcolor', 'extcolor'],
  plstate: ['platestate', 'registrationstate', 'state'],
  owner:   ['owner', 'ownername', 'registeredowner'],
  mileage: ['mileage', 'miles', 'odometer'],
};

function VehicleCard({ record, index }) {
  const scalars = collectScalars(record);
  const got = {};
  const usedPaths = new Set();
  for (const [slot, names] of Object.entries(FIELD_SETS)) {
    const hit = pickFrom(scalars, names, usedPaths);
    if (hit) { got[slot] = hit.value; usedPaths.add(pathKey(hit.path)); }
  }

  // A real "2015 Ford F-150" beats the map key, which beats a bare VIN.
  const title = [got.year, got.make, got.model].filter(Boolean).join(' ');
  const heading = title || record.Vehicle || got.vin || `Vehicle ${index + 1}`;
  if (record.Vehicle && heading === record.Vehicle) usedPaths.add(pathKey(['Vehicle']));

  // Everything not already promoted, one nesting level named "Parent · Child".
  const rest = [];
  for (const [k, v] of Object.entries(record)) {
    if (isScalar(v)) {
      if (!usedPaths.has(pathKey([k]))) rest.push([prettyKey(k), scalarText(v)]);
    } else if (Array.isArray(v)) {
      flattenFields(v, prettyKey(k), rest);
    } else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        const label = `${prettyKey(k)} · ${prettyKey(k2)}`;
        if (isScalar(v2)) {
          if (!usedPaths.has(pathKey([k, k2]))) rest.push([label, scalarText(v2)]);
        } else {
          flattenFields(v2, label, rest);
        }
      }
    }
  }

  const badges = [got.trim, got.color, got.mileage ? `${got.mileage} mi` : null].filter(Boolean);

  return (
    <Panel pad="md" radius="xl">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)' }}>
          <Car size={17} style={{ color: 'var(--color-primary-600)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-base font-bold leading-tight break-words" style={{ color: 'var(--color-text)' }}>{heading}</h4>
          {badges.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {badges.map((b, i) => <Chip key={i}>{b}</Chip>)}
            </div>
          )}
        </div>
      </div>

      {(got.vin || got.plate || got.owner) && (
        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {got.vin && (
            <Row icon={Hash} label="VIN">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono break-all">{got.vin}</span><CopyBtn value={got.vin} label="Copy VIN" />
              </span>
            </Row>
          )}
          {got.plate && (
            <Row icon={Hash} label="Plate">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono">{got.plate}{got.plstate ? ` · ${got.plstate}` : ''}</span>
                <CopyBtn value={got.plate} label="Copy plate" />
              </span>
            </Row>
          )}
          {got.owner && <Row icon={User} label="Owner">{got.owner}</Row>}
        </div>
      )}

      {rest.length > 0 && (
        <div className="mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          {rest.map(([label, value], i) => (
            <div key={`${label}-${i}`} className="flex items-baseline justify-between gap-2 text-xs min-w-0">
              <span className="flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
              <span className="min-w-0 text-right font-medium break-words" style={{ color: 'var(--color-text)' }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function VehicleResults({ data, onRetry }) {
  const [showRaw, setShowRaw] = useState(false);
  const records = useMemo(() => {
    if (!data) return [];
    // Normally data.vehicles; fall back to other envelopes rather than claiming
    // "none" when the service answered under a different key.
    const found = vehicleRecords(data.vehicles);
    if (found.length) return found;
    for (const k of ['results', 'data', 'records', 'list']) {
      const alt = vehicleRecords(data[k]);
      if (alt.length) return alt;
    }
    return [];
  }, [data]);

  if (!data) return null;

  // A search that FAILED and a search that found nothing are different facts,
  // and conflating them is why a broken provider looked like "this address has
  // no cars". The run reports its own status — believe it.
  const runStatus = data.result?.status || data.vehicles_status || null;
  const runError  = data.result?.error || data.vehicles_error || null;
  if (records.length === 0 && (runStatus === 'error' || runError)) {
    const transient = data.result?.error_transient;
    const short = String(runError || '').split('\n')[0].slice(0, 200);
    return (
      <EmptyState icon={AlertTriangle} tone="warn" title="The vehicle search did not complete"
        hint={`${short || 'The provider run failed.'}${data.result?.attempts ? ` (after ${data.result.attempts} attempts)` : ''} — no result was returned, so this is not the same as the address having no vehicles.${transient === false ? '' : ' It may be temporary, so a retry is worth a try.'}`}
        action={onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : null} />
    );
  }

  if (records.length === 0) {
    return (
      <EmptyState icon={Car} title="No vehicles on file for that address"
        hint={data.cached
          ? 'This address is already on file and no vehicles are recorded against it.'
          : 'Nothing is on file for this address yet. Add the person’s name and switch to “Search if new” to run a real search.'} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="m-0 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
          {records.length} vehicle{records.length === 1 ? '' : 's'} at this address
        </p>
        {/* Kept for support: the shape varies, and seeing it is how a missing
            field gets added to FIELD_SETS. Collapsed, so it is never the view. */}
        <button type="button" onClick={() => setShowRaw(v => !v)}
          className="text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
          {showRaw ? 'Hide raw response' : 'Show raw response'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {records.map((rec, i) => <VehicleCard key={i} record={rec} index={i} />)}
      </div>

      {showRaw && (
        <Panel pad="md" radius="xl" tone="inset">
          <pre className="m-0 text-[11px] overflow-x-auto whitespace-pre-wrap break-all"
            style={{ color: 'var(--color-text-secondary)' }}>{JSON.stringify(data, null, 2)}</pre>
        </Panel>
      )}
    </div>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
export default function CustomerLookupPanel({ access: accessProp }) {
  // The shell already knows the answer (it needs it to show the tab at all),
  // but the panel is also reachable on its own, so it asks when nobody told it.
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (accessProp) return;
    let dead = false;
    client.get('customer-lookup/my-access')
      .then(r => { if (!dead) setFetched(r.data); })
      .catch(() => { if (!dead) setFetched({ people: false, vehicles: false }); });
    return () => { dead = true; };
  }, [accessProp]);
  const access = accessProp || fetched;

  const canPeople   = !!access?.people;
  const canVehicles = !!access?.vehicles;
  const [tab, setTab] = useState('people');

  // Land on whichever search they actually hold once the answer arrives.
  useEffect(() => { if (access && !access.people && access.vehicles) setTab('vehicles'); }, [access]);

  // people
  const [mode, setMode]           = useState('phone');   // 'phone' | 'name'
  const [phone, setPhone]         = useState('');
  const [name, setName]           = useState('');
  const [q, setQ]                 = useState('');
  const [cacheOnly, setCacheOnly] = useState(false);
  const [withVehicles, setWithVehicles] = useState(false);   // /enrich: person AND vehicles
  const [pBusy, setPBusy]         = useState(false);
  const [pErr, setPErr]           = useState('');
  const [pData, setPData]         = useState(null);
  const [pIdx, setPIdx]           = useState(0);

  // vehicles
  const [vAddress, setVAddress] = useState('');
  const [vZip, setVZip]         = useState('');
  const [vName, setVName]       = useState('');
  const [vPhone, setVPhone]     = useState('');
  const [vBusy, setVBusy]       = useState(false);
  const [vErr, setVErr]         = useState('');
  const [vData, setVData]       = useState(null);
  const [cands, setCands]       = useState(null);   // addresses resolved from a person
  const [zipInfo, setZipInfo]   = useState(null);
  const [splitNote, setSplitNote] = useState(false);   // we split a pasted full address
  const [vDob, setVDob]         = useState('');
  const [vMode, setVMode]       = useState('auto');    // cache | auto | fresh
  const [jobNote, setJobNote]   = useState('');        // live progress of a running search

  // A new vehicle search fills a real quote form on the provider's site, which
  // takes far longer than a request should wait on. The server hands back a job
  // ticket instead and we poll it — slow is normal here, so show the seconds
  // ticking rather than an indefinite spinner.
  const pollJob = useCallback(async (ticket, onTick) => {
    const started = Date.now();
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, i < 5 ? 2000 : 4000));
      let r;
      try { r = await client.get(`customer-lookup/job/${ticket}`); }
      catch (e) { throw new Error(errText(e, 'Lost track of the search.')); }
      onTick?.(Math.round((Date.now() - started) / 1000));
      const st = r.data?.status;
      if (st === 'done' || st === 'error') return r.data;
    }
    throw new Error('The search is taking unusually long. Try again in a moment.');
  }, []);

  const { people, merged } = useMemo(() => peopleFrom(pData), [pData]);
  const person = people[pIdx] || people[0] || null;

  // ZIP → city/state, from the CRM's existing zippopotam route (24h cached).
  useEffect(() => {
    const z = digits(vZip).slice(0, 5);
    if (z.length !== 5) { setZipInfo(null); return; }
    let dead = false;
    client.get(`zipcode/${z}`)
      .then(r => { if (!dead) setZipInfo(r.data); })
      .catch(() => { if (!dead) setZipInfo({ error: true }); });
    return () => { dead = true; };
  }, [vZip]);

  const runPeople = useCallback(async () => {
    setPErr(''); setPData(null); setPIdx(0);
    if (mode === 'phone' && digits(phone).length < 10) { setPErr('Enter a 10-digit US phone number.'); return; }
    if (mode === 'name'  && q.trim().length < 3)       { setPErr('Type at least 3 characters.'); return; }
    setPBusy(true);
    try {
      if (mode === 'phone' && withVehicles && canVehicles) {
        // One call: who it is AND what they drive. The vehicle half can run a
        // real search, so this comes back as a job to poll.
        const r = await client.get('customer-lookup/enrich', {
          params: { phone: digits(phone), name: name.trim() || undefined, mode: cacheOnly ? 'cache' : 'auto' },
        });
        if (r.data?.job) {
          setJobNote('Searching...');
          const done = await pollJob(r.data.job, (sec) => setJobNote('Searching... ' + sec + 's'));
          setPData(done);
        } else {
          setPData(r.data);
        }
      } else {
        const r = mode === 'phone'
          ? await client.get('customer-lookup/person', { params: { phone: digits(phone), name: name.trim() || undefined, scrape: cacheOnly ? '0' : undefined } })
          : await client.get('customer-lookup/search', { params: { q: q.trim() } });
        setPData(r.data);
      }
    } catch (e) {
      setPErr(e?.response ? errText(e, 'Lookup failed.') : (e.message || 'Lookup failed.'));
    } finally { setPBusy(false); setJobNote(''); }
  }, [mode, phone, name, q, cacheOnly, withVehicles, canVehicles, pollJob]);

  const runVehicles = useCallback(async (override = {}) => {
    const address = (override.address ?? vAddress).trim();
    const zip     = digits(override.zip ?? vZip).slice(0, 5);
    const name    = (override.name ?? vName).trim();
    const dob     = (override.dob ?? vDob).trim();
    const mode    = override.mode ?? vMode;

    setVErr(''); setVData(null); setJobNote('');
    if (!address) { setVErr('Enter a street address, or find one from a name or phone below.'); return; }
    // Only a cache read can work without a name — a new search fills a quote
    // form. Saying so beats letting the server return an empty-looking result.
    if (mode !== 'cache' && !name) {
      setVErr('A new search needs the person’s name. Add it below, or switch to “Cached only”.');
      return;
    }

    setVBusy(true);
    try {
      const r = await client.get('customer-lookup/vehicles', {
        params: { address, zip: zip || undefined, name: name || undefined, dob: dob || undefined, mode },
      });
      if (r.data?.job) {
        setJobNote('Searching…');
        const done = await pollJob(r.data.job, (s) => setJobNote(`Searching… ${s}s`));
        setVData(done);
      } else {
        setVData(r.data);
      }
    } catch (e) {
      setVErr(e?.response ? errText(e, 'Vehicle search failed.') : (e.message || 'Vehicle search failed.'));
    } finally { setVBusy(false); setJobNote(''); }
  }, [vAddress, vZip, vName, vDob, vMode, pollJob]);

  // Name / phone → candidate addresses (server returns addresses only).
  const resolveAddresses = useCallback(async () => {
    setVErr(''); setCands(null); setVData(null);
    if (digits(vPhone).length < 10 && vName.trim().length < 3) {
      setVErr('Enter a phone number or at least 3 characters of a name.'); return;
    }
    setVBusy(true);
    try {
      const r = await client.get('customer-lookup/addresses', {
        params: { phone: digits(vPhone) || undefined, name: vName.trim() || undefined },
      });
      setCands(r.data.addresses || []);
      if (!r.data.addresses?.length) setVErr('No addresses found for that person.');
    } catch (e) {
      setVErr(errText(e, 'Could not find addresses for that person.'));
    } finally { setVBusy(false); }
  }, [vPhone, vName]);

  // Jump from a people result straight into a vehicle search.
  const gotoVehicles = useCallback((a) => {
    if (!canVehicles) return;
    if (a.addressFull) {
      // "4000 Central Florida BLVD Apt 68130, Orlando, FL 32816 8005"
      const parts = a.addressFull.split(',').map(s => s.trim());
      const zipM = a.addressFull.match(/\b(\d{5})(?:[-\s]\d{4})?\s*$/);
      setVAddress(parts[0] || a.addressFull);
      setVZip(zipM ? zipM[1] : '');
    } else {
      setVAddress(a.address || '');
      setVZip(a.zip || '');
    }
    if (a.name) setVName(a.name);
    setCands(null); setVData(null); setVErr('');
    setTab('vehicles');
  }, [canVehicles]);

  const tabs = [
    ...(canPeople   ? [{ key: 'people',   label: 'People',   icon: User }] : []),
    ...(canVehicles ? [{ key: 'vehicles', label: 'Vehicles', icon: Car  }] : []),
  ];

  if (!access) return <Loading variant="rows" rows={3} label="Checking your access" />;

  if (!canPeople && !canVehicles) {
    return (
      <EmptyState icon={Search} title="Customer lookup is not enabled for you"
        hint="A superadmin turns this on per person in User Control Center → Customer Lookup." />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
      <SectionHeader level="page" icon={Search} title="Customer Lookup"
        subtitle="Look a customer up by phone or name, and see the vehicles recorded at an address. Nothing you search here is saved to the CRM." />

      {tabs.length > 1 && <PillTabs items={tabs} value={tab} onChange={setTab} />}

      {/* ── PEOPLE ─────────────────────────────────────────────────────────── */}
      {tab === 'people' && canPeople && (
        <div className="space-y-4">
          <Panel pad="md" radius="xl">
            <div className="flex items-center gap-1.5 mb-3">
              {[{ k: 'phone', l: 'By phone' }, { k: 'name', l: 'By name' }].map(m => (
                <button key={m.k} type="button" onClick={() => { setMode(m.k); setPErr(''); }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors"
                  style={{
                    background: mode === m.k ? 'var(--color-primary-600)' : 'transparent',
                    color: mode === m.k ? '#fff' : 'var(--color-text-secondary)',
                    borderColor: mode === m.k ? 'var(--color-primary-600)' : 'var(--color-border)',
                  }}>{m.l}</button>
              ))}
            </div>

            {mode === 'phone' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Phone number" hint="10-digit US number">
                  <div className="relative">
                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input className="input pl-9" value={phone} inputMode="tel" placeholder="(772) 475-7074"
                      onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && runPeople()} />
                  </div>
                </Field>
                <Field label="Name (optional)" hint="Narrows a phone shared by several people">
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input className="input pl-9" value={name} placeholder="Megan Mauer"
                      onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && runPeople()} />
                  </div>
                </Field>
              </div>
            ) : (
              <Field label="Name or anything else" hint="Searches everything already on file">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input className="input pl-9" value={q} placeholder="Megan Mauer"
                    onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && runPeople()} />
                </div>
              </Field>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
              {mode === 'phone' ? (
                <div className="space-y-2">
                  <Toggle checked={cacheOnly} onChange={setCacheOnly} label="Cached only"
                    hint="Instant, but only returns someone already on file — never goes out to fetch." />
                  {canVehicles && (
                    <Toggle checked={withVehicles} onChange={setWithVehicles} label="Include vehicles"
                      hint="One search for the person and the vehicles at their address." />
                  )}
                </div>
              ) : <span />}
              <button type="button" onClick={() => runPeople()} disabled={pBusy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {pBusy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {pBusy ? 'Searching…' : 'Search'}
              </button>
            </div>
            {!cacheOnly && mode === 'phone' && (
              <p className="m-0 mt-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                A number nobody has looked up before has to be fetched, which can take a few seconds.
              </p>
            )}
          </Panel>

          {pErr && <Alert type="error" dismissible={false}>{pErr}</Alert>}

          {pData && people.length === 0 && (
            <EmptyState icon={User} title="Nobody found for that search"
              hint={cacheOnly ? 'Nothing is on file yet. Turn off "Cached only" to go and fetch it.' : 'Try the other spelling of the name, or a different number.'} />
          )}

          {people.length > 1 && (
            <Panel pad="md" radius="xl" tone="inset">
              <SectionHeader level="sub" icon={Users2} title={`${people.length} people matched — pick one`} />
              <div className="flex flex-wrap gap-1.5">
                {people.map((pp, i) => (
                  <button key={pp.detail_url || `${pp.name}-${i}`} type="button" onClick={() => setPIdx(i)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
                    style={{
                      background: i === pIdx ? 'color-mix(in srgb, var(--color-primary-600) 12%, var(--color-surface))' : 'var(--color-surface)',
                      borderColor: i === pIdx ? 'var(--color-primary-600)' : 'var(--color-border)',
                      color: i === pIdx ? 'var(--color-primary-600)' : 'var(--color-text)',
                    }}>
                    {pp.name || 'Unknown'}
                    {pp.age && <span style={{ color: 'var(--color-text-tertiary)' }}>· {pp.age}</span>}
                    {i === pIdx && <ChevronRight size={12} />}
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {person && (
            <>
              {pData?.cached !== undefined && (
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  <Database size={11} />
                  {pData.cached ? 'Served from the lookup service cache.' : 'Freshly fetched.'}
                </div>
              )}
              <PersonCard person={person} merged={merged} canVehicles={canVehicles} onVehicles={gotoVehicles} />
              {canVehicles && withVehicles && (pData?.vehicles || pData?.vehicles_status) && (
                <div className="space-y-2">
                  <SectionHeader level="sub" icon={Car} title="Vehicles at their address" />
                  <VehicleResults data={pData} onRetry={() => runPeople()} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── VEHICLES ───────────────────────────────────────────────────────── */}
      {tab === 'vehicles' && canVehicles && (
        <div className="space-y-4">
          <Panel pad="md" radius="xl">
            <SectionHeader level="sub" icon={MapPin} title="Search an address" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Street address" className="sm:col-span-2">
                <div className="relative">
                  <Home size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input className="input pl-9" value={vAddress} placeholder="169 W Euclid Ave"
                    onChange={e => {
                      const sp = splitFullAddress(e.target.value);
                      if (sp) { setVAddress(sp.street); setVZip(sp.zip); setSplitNote(true); }
                      else { setVAddress(e.target.value); setSplitNote(false); }
                    }}
                    onKeyDown={e => e.key === 'Enter' && runVehicles()} />
                </div>
              </Field>
              <Field label="ZIP"
                hint={zipInfo && !zipInfo.error ? `${zipInfo.city}, ${zipInfo.state_abbr}` : (zipInfo?.error ? 'ZIP not recognised' : '5 digits')}>
                <div className="relative">
                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input className="input pl-9" value={vZip} inputMode="numeric" placeholder="49203" maxLength={10}
                    onChange={e => setVZip(e.target.value)} onKeyDown={e => e.key === 'Enter' && runVehicles()} />
                </div>
              </Field>
            </div>
            {splitNote && (
              <p className="m-0 mt-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                Split the full address into the street and ZIP — that is what the service matches on.
              </p>
            )}

            {/* The person, not just the address. A cached address answers from
                the name alone being absent, but a NEW search fills a quote form
                and cannot start without a name — so these sit in the main form
                rather than being hidden as optional extras. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <Field label="Name" className="sm:col-span-2"
                hint={vMode === 'cache' ? 'Not needed for a cached address' : 'Required to run a new search'}>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input className="input pl-9" value={vName} placeholder="Alfredo Garcia"
                    onChange={e => setVName(e.target.value)} onKeyDown={e => e.key === 'Enter' && runVehicles()} />
                </div>
              </Field>
              <Field label="Date of birth" hint="Optional, but makes a match far more likely">
                <div className="relative">
                  <CalendarClock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input className="input pl-9" value={vDob} placeholder="03/24/1946"
                    onChange={e => setVDob(e.target.value)} onKeyDown={e => e.key === 'Enter' && runVehicles()} />
                </div>
              </Field>
            </div>

            {/* How hard to look. A cached address is instant and free; a new
                search runs against the provider and takes a while, so the
                choice is the user's rather than a hidden default. */}
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              {[
                { k: 'cache', l: 'Cached only',   t: 'Instant. Only answers for an address already on file.' },
                { k: 'auto',  l: 'Search if new', t: 'Uses the cache, and runs a real search when the address is not on file.' },
                { k: 'fresh', l: 'Force fresh',   t: 'Always runs a new search, even if the address is cached.' },
              ].map(m => (
                <button key={m.k} type="button" onClick={() => setVMode(m.k)} title={m.t}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors"
                  style={{
                    background: vMode === m.k ? 'var(--color-primary-600)' : 'transparent',
                    color: vMode === m.k ? '#fff' : 'var(--color-text-secondary)',
                    borderColor: vMode === m.k ? 'var(--color-primary-600)' : 'var(--color-border)',
                  }}>{m.l}</button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
              <p className="m-0 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                {jobNote
                  || (vMode === 'cache'
                    ? 'Reads what is already on file — instant, and never goes out to search.'
                    : 'A new search runs against the provider and can take a minute.')}
              </p>
              <button type="button" onClick={() => runVehicles()} disabled={vBusy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {vBusy ? <Loader2 size={15} className="animate-spin" /> : <Car size={15} />}
                {vBusy ? (jobNote || 'Searching…') : 'Find vehicles'}
              </button>
            </div>
          </Panel>

          <Panel pad="md" radius="xl" tone="inset">
            <SectionHeader level="sub" icon={User} title="Don't know the address?"
              actions={<span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>find it from a name or phone</span>} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone">
                <input className="input" value={vPhone} inputMode="tel" placeholder="(772) 475-7074"
                  onChange={e => setVPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && resolveAddresses()} />
              </Field>
              <Field label="Name">
                <input className="input" value={vName} placeholder="Megan Mauer"
                  onChange={e => setVName(e.target.value)} onKeyDown={e => e.key === 'Enter' && resolveAddresses()} />
              </Field>
            </div>
            <div className="flex items-center justify-end mt-3">
              <button type="button" onClick={resolveAddresses} disabled={vBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-surface)' }}>
                {vBusy ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />} Find their addresses
              </button>
            </div>

            {cands && cands.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  {cands.length} address{cands.length === 1 ? '' : 'es'} — pick one to search
                </p>
                <ul className="m-0 p-0 list-none space-y-1 max-h-64 overflow-y-auto">
                  {cands.map((a, i) => (
                    <li key={`${a.full}-${i}`}>
                      <button type="button"
                        onClick={() => { setVAddress(a.street); setVZip(a.zip || ''); if (a.person) setVName(a.person); setCands(null); runVehicles({ address: a.street, zip: a.zip, name: a.person || vName }); }}
                        className="w-full text-left flex items-center gap-2 text-xs rounded-lg px-2.5 py-2 transition-colors"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        <MapPin size={12} className="flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
                        <span className="min-w-0 flex-1 truncate">{a.full}</span>
                        {a.person && <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{a.person}</span>}
                        <ChevronRight size={12} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {vErr && <Alert type="error" dismissible={false}>{vErr}</Alert>}

          {vData && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                <MapPin size={11} /> {vData.address}{vZip ? ` · ${digits(vZip).slice(0, 5)}` : ''}
                {zipInfo && !zipInfo.error ? ` · ${zipInfo.city}, ${zipInfo.state_abbr}` : ''}
              </div>
              <VehicleResults data={vData} onRetry={() => runVehicles()} />
            </div>
          )}
        </div>
      )}

      <p className="m-0 text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        <AlertTriangle size={12} className="flex-shrink-0 mt-px" />
        Use this only to verify a customer you are already working with. Every search is logged against your name.
      </p>
    </div>
  );
}
