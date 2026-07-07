import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import client from '../../api/client';
import NumberUploadManager from './NumberUploadManager';

// Company-scoped wrapper for cross-company roles (superadmin / compliance): pick
// a company, then upload + assign + manage that company's number lists. Managers
// use NumberUploadManager directly (scoped to their own company).
export default function NumberAssignmentPanel({ user }) {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    client.get('number-lists/companies')
      .then(r => {
        const cos = r.data.companies || r.data || [];
        setCompanies(cos);
        setCompanyId(prev => prev || cos[0]?.id || '');
      })
      .catch(e => setErr(e.response?.data?.error || 'Could not load companies'));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <span className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <Building2 size={15} style={{ color: 'var(--color-primary-600)' }} /> Company
        </span>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input text-sm" style={{ minWidth: 220 }}>
          <option value="">— Select a company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}{c.company_type ? ` · ${c.company_type}` : ''}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Pick a company to upload &amp; assign its numbers.</span>
      </div>

      {err && <p className="text-sm" style={{ color: '#dc2626' }}>{err}</p>}

      {companyId
        ? <NumberUploadManager key={companyId} user={user} companyId={companyId} />
        : <p className="text-sm italic px-1" style={{ color: 'var(--color-text-tertiary)' }}>Select a company above to begin.</p>}
    </div>
  );
}
