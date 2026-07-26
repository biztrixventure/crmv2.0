// ClientAccessSection — pick which warranty clients this user may work. When a
// user is restricted, their Sale/Transfer form only shows these clients (and,
// via the existing cascade, only those clients' plans). Selecting NOTHING =
// unrestricted (sees all) — the default, so existing users are unaffected.
//
// Storage is per auth-user (business_config client_access.<userId>) via
// GET/PUT /users/:userId/client-access. Catalog + plans-per-client come from the
// same sources the form uses (sale-configs + the sale_plan field's options), so
// what you grant here is exactly what the user sees.
import { useState, useEffect, useCallback } from 'react';
import { Briefcase, Loader2, Save, Check, Globe } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';

export default function ClientAccessSection({ account, assignment }) {
  const userId = account.user_id;
  const companyId = assignment?.company_id;
  const [catalog, setCatalog]   = useState([]);          // [{id,value}] clients
  const [planMap, setPlanMap]   = useState({});          // client -> [plans]
  const [selected, setSelected] = useState([]);          // chosen client values ([] = unrestricted)
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, catRes, fieldsRes] = await Promise.all([
        client.get(`users/${userId}/client-access`),
        client.get('sale-configs', { params: { type: 'client', ...(companyId ? { company_id: companyId } : {}) } }),
        client.get('forms/fields').catch(() => ({ data: { fields: [] } })),
      ]);
      setSelected(Array.isArray(accRes.data.clients) ? accRes.data.clients : []);
      setCatalog((catRes.data.configs || []).map(c => ({ id: c.id, value: c.value })));
      const fields = fieldsRes.data.fields || fieldsRes.data || [];
      const planField = (Array.isArray(fields) ? fields : []).find(f => f.field_type === 'sale_plan' && Array.isArray(f.options) && f.options.length);
      const map = {};
      (planField?.options || []).forEach(m => { if (m && m.client) map[m.client] = m.plans || []; });
      setPlanMap(map);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load.'); }
    finally { setLoading(false); }
  }, [userId, companyId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (value) => setSelected(s => s.includes(value) ? s.filter(x => x !== value) : [...s, value]);
  const restricted = selected.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const r = await client.put(`users/${userId}/client-access`, { clients: selected });
      // Reflect exactly what the server stored (authoritative) — never trust local
      // state as "saved". Response: { clients: [...] | null }.
      const saved = Array.isArray(r.data?.clients) ? r.data.clients : [];
      setSelected(saved);
      flash('success', saved.length ? `Restricted to ${saved.length} client(s).` : 'Unrestricted — user sees all clients.');
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed — reverting to the saved state.');
      await load();   // re-sync to server truth so the UI can't show an unsaved selection
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Briefcase size={16} style={{ color: 'var(--color-primary-600)' }} />
        <h3 className="text-sm font-bold text-text">Client access</h3>
      </div>
      <p className="text-[11px] text-text-secondary mb-3">
        Pick the clients this user may work. On their Sale/Transfer form they'll only see these clients (and each client's plans). Select none to leave them unrestricted (all clients).
      </p>
      {msg && <div className="mb-3"><Alert type={msg.type}>{msg.text}</Alert></div>}

      {/* Status banner */}
      <div className="rounded-2xl p-3 mb-3 flex items-center gap-2 text-sm font-semibold"
        style={{ background: restricted ? 'var(--color-primary-50, rgba(99,102,241,0.08))' : 'var(--color-bg)', border: `1px solid ${restricted ? 'var(--color-primary-400)' : 'var(--color-border)'}`, color: restricted ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
        {restricted ? <><Check size={15} /> Restricted to {selected.length} client{selected.length === 1 ? '' : 's'}</> : <><Globe size={15} /> Unrestricted — sees all clients</>}
        {restricted && <button onClick={() => setSelected([])} className="ml-auto text-[11px] font-semibold underline">Clear (unrestrict)</button>}
      </div>

      {catalog.length === 0 ? (
        <div className="text-sm text-text-secondary py-8 text-center">No clients in the catalog{companyId ? ' for this company' : ''}. Add them in Clients &amp; Plans first.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {catalog.map(c => {
            const on = selected.includes(c.value);
            const plans = planMap[c.value] || [];
            return (
              <button key={c.id} onClick={() => toggle(c.value)}
                className="text-left rounded-2xl p-3 flex items-start gap-2.5 transition-all"
                style={{ background: on ? 'var(--color-primary-50, rgba(99,102,241,0.08))' : 'var(--color-bg)', border: `1px solid ${on ? 'var(--color-primary-500)' : 'var(--color-border)'}` }}>
                <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: on ? 'var(--color-primary-600)' : 'transparent', border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                  {on && <Check size={13} style={{ color: '#fff' }} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{c.value}</span>
                  <span className="block text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                    {plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'}: ${plans.slice(0, 4).join(', ')}${plans.length > 4 ? '…' : ''}` : 'no plans mapped'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button onClick={save} disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save client access
      </button>
    </div>
  );
}
