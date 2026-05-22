// Field-by-field diff review for sale UPDATES. Each record is reviewed
// individually (include/exclude); colors flag the kind of change:
//   yellow = normal field · purple = status/approval · blue = compliance
const CAT = {
  normal:     { bg: 'rgba(245,158,11,0.10)', text: '#b45309', label: 'Field' },
  approval:   { bg: 'rgba(168,85,247,0.12)', text: '#7c3aed', label: 'Approval' },
  compliance: { bg: 'rgba(59,130,246,0.12)', text: '#2563eb', label: 'Compliance' },
};

const SaleUpdateReviewer = ({ updates, decisions, toggleUpdate, setAllUpdates }) => {
  if (!updates.length) return null;
  const included = updates.filter((_, i) => decisions[i]).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {included} of {updates.length} updates selected. Review each before confirming.
        </p>
        <div className="flex gap-2">
          <button onClick={() => setAllUpdates(true)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ color: 'var(--color-primary-600)', backgroundColor: 'var(--color-primary-50)' }}>Confirm all updates</button>
          <button onClick={() => setAllUpdates(false)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}>Exclude all</button>
        </div>
      </div>

      {updates.map((u, i) => {
        const on = !!decisions[i];
        return (
          <div key={i} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${on ? 'var(--color-primary-300)' : 'var(--color-border)'}` }}>
            <div className="flex items-center justify-between gap-3 p-3" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                  ⚠️ {u.customer_name || u.cli_number || 'Existing sale'} — {u.changes.length} change{u.changes.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{u.fronter_name} · {u.company_name} · {u.cli_number}</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0">
                <input type="checkbox" checked={on} onChange={() => toggleUpdate(i)} />
                <span className="text-xs font-semibold" style={{ color: on ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{on ? 'Will update' : 'Skip'}</span>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Field</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Previous</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>New</th>
                  </tr>
                </thead>
                <tbody>
                  {u.changes.map((c, j) => {
                    const cat = CAT[c.category] || CAT.normal;
                    return (
                      <tr key={j} style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: cat.bg }}>
                        <td className="px-3 py-2">
                          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{c.label}</span>
                          <span className="text-[9px] ml-1.5 px-1 py-0.5 rounded font-bold uppercase" style={{ color: cat.text }}>{cat.label}</span>
                        </td>
                        <td className="px-3 py-2 line-through" style={{ color: 'var(--color-text-tertiary)' }}>{String(c.prev ?? '') || '—'}</td>
                        <td className="px-3 py-2 font-semibold" style={{ color: cat.text }}>{String(c.next ?? '') || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SaleUpdateReviewer;
