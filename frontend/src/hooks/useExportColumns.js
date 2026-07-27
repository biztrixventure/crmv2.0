import { useEffect, useRef, useState } from 'react';
import client from '../api/client';

// ============================================================================
// useExportColumns — resolve THIS user's allowed export columns per dataset.
//
// Config source: business_config export.columns.* via GET /egress/my-columns
// (any authed user; /egress/columns stays superadmin-only because it can read
// any scope). The server applies the precedence — per-user map → per-role →
// 'all' — so a shell never has to know the scope rules.
//
// null for a dataset means UNCONFIGURED, which resolveColumns() reads as "keep
// this surface's own default column list". That is what makes the whole feature
// invisible until a superadmin configures something: no config, same file.
//
// Twin of useListLayout (list.layout / page size); a separate hook because it
// is keyed by dataset set rather than by shell.
// ============================================================================
export function useExportColumns(datasets) {
  const key = (datasets || []).join(',');
  const [columns, setColumns] = useState({});
  const [loaded, setLoaded] = useState(false);
  // Guard against a slow response for an earlier dataset set landing last.
  const reqRef = useRef(0);

  useEffect(() => {
    if (!key) { setColumns({}); setLoaded(true); return; }
    const seq = ++reqRef.current;
    let alive = true;
    client.get('egress/my-columns', { params: { datasets: key } })
      .then(r => { if (alive && seq === reqRef.current) setColumns(r.data?.columns || {}); })
      .catch(() => { if (alive && seq === reqRef.current) setColumns({}); })   // unreachable config → today's defaults
      .finally(() => { if (alive && seq === reqRef.current) setLoaded(true); });
    return () => { alive = false; };
  }, [key]);

  return { columns, loaded, allowedFor: (ds) => columns[ds] ?? null };
}

export default useExportColumns;
