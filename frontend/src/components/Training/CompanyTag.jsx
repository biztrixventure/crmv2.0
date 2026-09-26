import { Building2, Globe2 } from 'lucide-react';

// WHOSE TRAINING IS THIS. An admin reading every company at once (Company ->
// All companies) sees one flat list, and without this tag a document from one
// tenant is indistinguishable from another's -- which makes the all-companies
// view good for a count and useless for an answer.
//
// Renders NOTHING when there is only one company in play: a tag that says the
// same thing on every row is noise. `companies` is the list the portal already
// has from /training/my-scope, so naming the owner costs no extra request.
export default function CompanyTag({ companyId, companies = [] }) {
  if (!companies || companies.length < 2) return null;
  const shared = !companyId;
  const name = shared ? 'Shared' : (companies.find(c => c.id === companyId)?.name || 'Another company');
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0"
      title={shared ? 'Shared with every company' : `Belongs to ${name}`}
      style={shared
        ? { backgroundColor: 'rgba(124,58,237,0.12)', color: '#7c3aed' }
        : { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
      {shared ? <Globe2 size={9} /> : <Building2 size={9} />} {name}
    </span>
  );
}
