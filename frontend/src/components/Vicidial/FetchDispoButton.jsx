import { useState } from 'react';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// "Fetch Dispo" — pulls a record's closer disposition on demand (from the CRM
// queue first, else the dialer) and attaches it. For any CRM user on a transfer
// that's missing its disposition. Calls onFetched() so the parent can refresh.
export default function FetchDispoButton({ transferId, onFetched }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy || !transferId) return;
    setBusy(true);
    try {
      const r = await client.post(`vicidial/fetch-dispo/${transferId}`);
      if (r.data.ok) {
        toast.success(`Disposition: ${r.data.disposition_name}${r.data.source === 'dialer' ? ' (from dialer)' : ''}`);
        onFetched?.(r.data);
      } else {
        toast.info(r.data.message || 'No disposition found yet');
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Fetch failed');
    } finally { setBusy(false); }
  };
  return (
    <button onClick={run} disabled={busy} title="Pull this call's disposition from the dialer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-60"
      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
      {busy ? 'Fetching…' : 'Fetch dispo'}
    </button>
  );
}
