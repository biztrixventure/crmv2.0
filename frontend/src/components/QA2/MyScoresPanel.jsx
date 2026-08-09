// ============================================================================
// MyScoresPanel.jsx — fronter/closer read-only view of their own QA v2
// scores. Lives in StaffShell (via CrossRoleContent), NOT QA2Shell — fronters
// and closers aren't in the qa_agent/qa_manager/compliance_manager role
// group QA2Shell's route requires. Final score + pass/fail only, matching
// exactly what GET /qa2/my-scores returns — no per-parameter detail exists
// here to show even if someone tried.
// ============================================================================

import { useState, useEffect } from 'react';
import { Award, CheckCircle2, XCircle } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';

export default function MyScoresPanel() {
  const [scores, setScores] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    client.get('qa2/my-scores')
      .then(r => setScores(r.data.scores || []))
      .catch(e => setLoadError(e.response?.data?.error || 'Could not load your QA scores'));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <SectionHeader level="page" icon={Award} title="My QA scores" subtitle="Final score and pass/fail for calls reviewed against QA v2 scorecards." />

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && scores === null && <Loading variant="table" rows={4} />}
      {!loadError && scores && scores.length === 0 && (
        <EmptyState icon={Award} title="No QA scores yet" hint="Scores appear here once a reviewer submits an evaluation for one of your calls." />
      )}

      {!loadError && scores && scores.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Date</th>
                <th className="text-left font-semibold px-3 py-2">Company</th>
                <th className="text-left font-semibold px-3 py-2">Method</th>
                <th className="text-left font-semibold px-3 py-2">Score</th>
                <th className="text-left font-semibold px-3 py-2">Result</th>
              </tr></thead>
              <tbody>
                {scores.map(s => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{s.date ? new Date(s.date).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2">{s.company}</td>
                    <td className="px-3 py-2">{s.method}</td>
                    <td className="px-3 py-2"><strong>{s.final_score ?? '—'}</strong></td>
                    <td className="px-3 py-2">
                      {s.result === 'pass' && <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-success-600)' }}><CheckCircle2 size={13} />Pass</span>}
                      {s.result === 'fail' && <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-error-600)' }}><XCircle size={13} />Fail</span>}
                      {!s.result && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}
