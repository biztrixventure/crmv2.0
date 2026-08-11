import { useState, useEffect } from 'react';
import { CircleDollarSign } from 'lucide-react';
import client from '../../../api/client';

// Business Rules → DP Status Clients. Which clients get their own DP Status
// card (All/Pending/Paid/Reverted $ + count) on the Compliance Sales tab,
// alongside the existing combined DP Status card. Deliberately global-only
// (client_name spans companies) and independent of the Sales tab's own
// Client column filter — ticking a client here just adds its card; picking
// a client in the filter narrows the table, not this list.
const KEY = 'compliance.dp_status_clients';

const DpStatusClientsRules = ({ config, onSave }) => {
  const [allClients, setAllClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('compliance/clients')
      .then(r => setAllClients(r.data?.clients || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selected = Array.isArray(config?.[KEY]) ? config[KEY] : [];
  const selectedSet = new Set(selected);

  const toggle = (name) => {
    const next = selectedSet.has(name) ? selected.filter(c => c !== name) : [...selected, name];
    onSave(KEY, next);
  };
  const selectAll = () => onSave(KEY, allClients.slice());
  const selectNone = () => onSave(KEY, []);

  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid #2563eb' };

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <CircleDollarSign size={18} style={{ color: '#2563eb' }} />
          <h2 className="text-base font-bold text-text">DP Status Clients</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">
          On the Compliance <b>Sales</b> tab, the DP Status KPI area normally shows one combined
          card summing every client together. Tick clients here to also break each one out into
          its own card (Pending / Paid / Reverted, $ + count) — independent of whatever the
          Client column filter is set to, so all ticked clients stay visible side by side.
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : allClients.length === 0 ? (
          <p className="text-sm text-text-tertiary py-4">No clients found on any sale yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
                {selected.length} of {allClients.length} selected
              </span>
              <button onClick={selectAll} className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ color: '#1d4ed8', background: '#dbeafe' }}>Select all</button>
              <button onClick={selectNone} className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>Select none</button>
            </div>
            <div className="space-y-1.5">
              {allClients.map(name => (
                <label key={name} className="flex items-center gap-3 p-2 rounded-xl cursor-pointer"
                  style={{ background: 'var(--color-bg-secondary)' }}>
                  <input type="checkbox" checked={selectedSet.has(name)} onChange={() => toggle(name)}
                    className="w-4 h-4" style={{ accentColor: '#2563eb' }} />
                  <span className="text-sm font-semibold text-text">{name}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DpStatusClientsRules;
