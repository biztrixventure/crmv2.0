import { useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// Compliance: bulk-fetch dispositions for every undisposed transfer (all
// companies) in a window — default today's shift. Pulls each closer's dispo +
// attributes the closer. Throttled server-side; safe to re-run (skips done).
export default function FetchAllDisposButton({ onDone }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    if (!window.confirm("Fetch dispositions for ALL of today's undisposed transfers across every company? This pulls from the dialers and may take a minute.")) return;
    setBusy(true);
    toast.loading('Fetching dispositions from the dialers…', { id: 'fetchall' });
    try {
      const r = await client.post('vicidial/fetch-all-dispos', {});
      const d = r.data || {};
      toast.success(`Fetched ${d.fetched || 0} of ${d.undisposed || 0} undisposed (${d.in_window || 0} in window).`, { id: 'fetchall' });
      onDone?.(d);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Bulk fetch failed', { id: 'fetchall' });
    } finally { setBusy(false); }
  };
  return (
    <button onClick={run} disabled={busy} title="Fetch every undisposed transfer's disposition (all companies, today)"
      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-60"
      style={{ background: 'var(--gradient-sidebar)', color: 'white' }}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
      {busy ? 'Fetching all…' : 'Fetch all dispos (today)'}
    </button>
  );
}
