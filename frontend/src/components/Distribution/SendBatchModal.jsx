import { useState, useEffect } from 'react';
import { X, Loader2, Send, Filter } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import UserPicker from './UserPicker';
import RulePreview from './RulePreview';

// Distribute the Data Analyzer's current filtered result as an original batch.
export default function SendBatchModal({ dataset, filters, onClose, onSent }) {
  const [name, setName] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [phones, setPhones] = useState(null);   // R1: resolved once, reused per recipient

  // R1 — resolve the DISTINCT phone set ONCE when the modal opens. Recipient
  // changes then reuse this cached array instead of re-pulling the dataset.
  useEffect(() => {
    let cancelled = false;
    client.post('data-analyzer/send-batch/phones', { dataset, filters })
      .then(r => { if (!cancelled) setPhones(r.data.phones || []); })
      .catch(() => { if (!cancelled) setPhones([]); });
    return () => { cancelled = true; };
  }, [dataset, filters]);

  // Dry-run rule preview whenever a recipient is chosen — uses the cached phones.
  useEffect(() => {
    if (!recipient || phones == null) { setPreview(null); return; }
    let cancelled = false; setPreviewing(true);
    client.post('data-analyzer/send-batch/preview', { phones, recipient_id: recipient.id })
      .then(r => { if (!cancelled) setPreview(r.data); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [recipient, phones]);

  const send = async () => {
    if (!name.trim()) return toast.error('Give the batch a name');
    if (!recipient) return toast.error('Pick who to send it to');
    setSaving(true);
    try {
      const r = await client.post('data-analyzer/send-batch', { dataset, filters, name: name.trim(), recipient_id: recipient.id });
      toast.success(`Sent “${r.data.batch.name}” — ${r.data.batch.item_count} numbers to ${recipient.name}`);
      onSent?.(r.data.batch); onClose();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not send batch'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Send size={16} style={{ color: 'var(--color-primary-600)' }} />
          <div className="font-bold flex-1" style={{ color: 'var(--color-text)' }}>Send batch</div>
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Distributes the <b>{dataset}</b> result of your current filters, de-duplicated to distinct phone numbers.
          </p>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Batch name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Texas non-buyers — Feb"
              className="w-full text-sm rounded-lg px-3 py-2 mt-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Send to</label>
            <div className="mt-1"><UserPicker value={recipient} onChange={setRecipient} /></div>
            {recipient && <RulePreview preview={preview} previewing={previewing} recipientName={recipient.name} />}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={send} disabled={saving || !recipient || !name.trim()} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send{recipient ? ` to ${recipient.name.split(' ')[0]}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
