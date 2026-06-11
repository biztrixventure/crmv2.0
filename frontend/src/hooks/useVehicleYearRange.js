import { useEffect, useState } from 'react';
import client from '../api/client';

// Reads the admin-configured model-year range from business_config
// (vehicle.year_min / vehicle.year_max) so the Sale + Transfer forms render the
// vehicle Year field as a bounded dropdown instead of free text. Cached in a
// module-level promise so multiple forms on a page share one request.
//
// Defaults when unset: min = 1990, max = current year + 1 (next model year is
// commonly already on the road by Q4).
const DEFAULT_MIN = 1990;
const DEFAULT_MAX = new Date().getFullYear() + 1;

let _cache = null;        // { min, max }
let _inflight = null;     // Promise

async function fetchRange() {
  if (_cache) return _cache;
  if (!_inflight) {
    _inflight = client.get('business-config')
      .then(r => {
        const cfg = r.data?.config || {};
        const min = parseInt(cfg['vehicle.year_min'], 10);
        const max = parseInt(cfg['vehicle.year_max'], 10);
        _cache = {
          min: Number.isFinite(min) ? min : DEFAULT_MIN,
          max: Number.isFinite(max) ? max : DEFAULT_MAX,
        };
        return _cache;
      })
      .catch(() => { _cache = { min: DEFAULT_MIN, max: DEFAULT_MAX }; return _cache; })
      .finally(() => { _inflight = null; });
  }
  return _inflight;
}

export function useVehicleYearRange() {
  const [range, setRange] = useState(_cache || { min: DEFAULT_MIN, max: DEFAULT_MAX });

  useEffect(() => {
    let alive = true;
    fetchRange().then(r => { if (alive) setRange(r); });
    return () => { alive = false; };
  }, []);

  // Descending list (newest first) — what closers expect in a year picker.
  const lo = Math.min(range.min, range.max);
  const hi = Math.max(range.min, range.max);
  const years = [];
  for (let y = hi; y >= lo; y--) years.push(y);

  return { ...range, years };
}
