// ============================================================================
// TrainingPortal -- one component, every shell.
//
// A trainee is a fronter who has not been signed off yet, so the portal is
// mounted the same way in the staff shell, the manager shell, the compliance
// shell and the admin panel. Promoting someone from trainee to fronter changes
// their role and nothing else: the tab is still there, the material is still
// theirs, and no code had to know the promotion happened. That is the whole
// reason this is a section rather than a shell of its own.
//
// THE QUIZ LIVES HERE NOW. It used to be its own "My Quizzes" nav item in the
// staff shell; a quiz is training, so it became a tab instead of a sibling.
// MyQuizzes itself is untouched and still mounted by the manager and compliance
// shells under their own nav -- folding the surface in did not fork it.
//
// WHAT IS FREE: the Tool Kit speaks with the browser's own voice (see
// useSpeech.js). No key, no quota, no per-word cost.
// ============================================================================
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  GraduationCap, FileText, BookOpen, Volume2, MessageSquareWarning, Headphones,
  ClipboardList, Settings2, Building2, CheckCircle2,
} from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, PillTabs, Loading, KpiTile } from '../UI/kit';
import Select from '../UI/Select';
import ToolKitPanel from './ToolKitPanel';
import DocumentsPanel from './DocumentsPanel';
import RecordingsPanel from './RecordingsPanel';
import ScenariosPanel from './ScenariosPanel';

// Reused wholesale rather than reimplemented. Scripts already has a searchable,
// role-scoped reader; a second one would be a second thing to keep correct.
const ScriptPanel      = lazy(() => import('../FAQ/ScriptPanel'));
const MyQuizzes        = lazy(() => import('../Quiz/MyQuizzes'));
const TrainingManager  = lazy(() => import('./TrainingManager'));

const TabFallback = () => (
  <div className="flex justify-center py-12">
    <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" />
  </div>
);

export default function TrainingPortal() {
  const [scope, setScope]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [tab, setTab] = useState('documents');
  const [progress, setProgress] = useState([]);

  useEffect(() => {
    let dead = false;
    client.get('training/my-scope')
      .then(r => {
        if (dead) return;
        setScope(r.data);
        // Fall back to the first company they may use. A superadmin often has
        // no home company, and an unset picker means an unset company_id --
        // which the API reads as "global", so an upload meant for one tenant
        // would silently land in every one of them.
        setCompanyId(r.data.company_id || r.data.companies?.[0]?.id || '');
      })
      .catch(() => { if (!dead) setScope({ can_view: false }); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, []);

  const loadProgress = useCallback(() => {
    client.get('training/progress/me')
      .then(r => setProgress(r.data.progress || []))
      .catch(() => setProgress([]));
  }, []);
  useEffect(() => { loadProgress(); }, [loadProgress]);

  // Record that this person touched something. Fire-and-forget on purpose: a
  // failed progress write must never block the material from opening, and the
  // next open re-records it anyway.
  const mark = useCallback((itemType, itemId, status = 'opened', itemKey = null) => {
    client.post('training/progress', { item_type: itemType, item_id: itemId, item_key: itemKey, status })
      .then(loadProgress)
      .catch(() => { /* progress is a nicety, never a gate */ });
  }, [loadProgress]);

  const done = useMemo(() => {
    const set = new Set();
    for (const p of progress) if (p.status === 'completed') set.add(`${p.item_type}:${p.item_id || p.item_key}`);
    return set;
  }, [progress]);

  const counts = useMemo(() => ({
    opened:    progress.length,
    completed: progress.filter(p => p.status === 'completed').length,
  }), [progress]);

  if (loading) return <Loading variant="rows" rows={5} label="Opening the training portal" />;

  if (!scope?.can_view) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Panel tone="inset" radius="2xl" pad="lg">
          <SectionHeader icon={GraduationCap} title="Training" />
          <p className="text-sm m-0" style={{ color: 'var(--color-text-secondary)' }}>
            You do not have access to the training material. Ask your manager to turn on Training for your role.
          </p>
        </Panel>
      </div>
    );
  }

  const canManage = !!scope.can_manage;
  const companies = scope.companies || [];

  const tabs = [
    { key: 'documents',  label: 'Documents',  icon: BookOpen },
    { key: 'scripts',    label: 'Scripts',    icon: FileText },
    { key: 'toolkit',    label: 'Tool Kit',   icon: Volume2 },
    { key: 'scenarios',  label: 'Scenarios',  icon: MessageSquareWarning },
    { key: 'recordings', label: 'Recordings', icon: Headphones },
    { key: 'quizzes',    label: 'Quizzes',    icon: ClipboardList },
    ...(canManage ? [{ key: 'manage', label: 'Manage', icon: Settings2 }] : []),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader icon={GraduationCap} title="Training"
          subtitle={scope.is_trainee
            ? 'Work through everything here. Your manager can see how far you have got.'
            : 'The material new hires learn from — and a refresher whenever you want one.'} />

        <div className="flex items-end gap-3">
          {/* Managers and superadmins point the portal at a company. A trainee
              never sees this: they have exactly one company, and a picker with
              one entry is a control that does nothing. */}
          {canManage && companies.length > 1 && (
            <div style={{ minWidth: 200 }}>
              <span className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"
                style={{ color: 'var(--color-text-secondary)' }}>
                <Building2 size={11} /> Company
              </span>
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          )}
          {!canManage && (
            <div className="flex gap-2">
              <KpiTile icon={BookOpen} label="Opened" value={counts.opened} tone="info" />
              <KpiTile icon={CheckCircle2} label="Finished" value={counts.completed} tone="success" />
            </div>
          )}
        </div>
      </div>

      <PillTabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'documents' && (
        <DocumentsPanel companyId={companyId} done={done}
          onOpen={(id) => mark('document', id, 'opened')}
          onFinish={(id) => mark('document', id, 'completed')} />
      )}

      {tab === 'scripts' && (
        <Suspense fallback={<TabFallback />}><ScriptPanel /></Suspense>
      )}

      {tab === 'toolkit' && (
        <ToolKitPanel companyId={companyId}
          onProgress={() => mark('toolkit', null, 'opened', 'pronunciation')} />
      )}

      {tab === 'scenarios' && (
        <ScenariosPanel companyId={companyId} done={done}
          onAnswered={(id, correct) => mark('scenario', id, correct ? 'completed' : 'opened')} />
      )}

      {tab === 'recordings' && (
        <RecordingsPanel companyId={companyId} done={done}
          onOpen={(id) => mark('recording', id, 'opened')}
          onFinish={(id) => mark('recording', id, 'completed')} />
      )}

      {tab === 'quizzes' && (
        <Suspense fallback={<TabFallback />}><MyQuizzes /></Suspense>
      )}

      {tab === 'manage' && canManage && (
        <Suspense fallback={<TabFallback />}>
          <TrainingManager companyId={companyId} canProgress={!!scope.can_progress} />
        </Suspense>
      )}
    </div>
  );
}
