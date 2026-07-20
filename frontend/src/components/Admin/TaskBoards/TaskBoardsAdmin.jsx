import { useState, useEffect, useCallback } from 'react';
import { LayoutGrid, Plus, Copy, ExternalLink, Trash2, Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../UI';
import client from '../../../api/client';

// Superadmin manager for Kanban task boards (kan.bn-style). Create a board, get
// a shareable no-login link, hand it to whoever needs to add tasks. The board
// itself lives at /board/:token and needs no account — the link is the key.
export default function TaskBoardsAdmin() {
  const [boards, setBoards] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => client.get('kanban/boards').then(r => setBoards(r.data.boards || [])).catch(() => setBoards([])), []);
  useEffect(() => { load(); }, [load]);

  const linkFor = (b) => `${window.location.origin}/board/${b.share_token}`;

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { const r = await client.post('kanban/boards', { title: title.trim() }); setTitle(''); await load();
      const b = r.data.board; navigator.clipboard?.writeText(`${window.location.origin}/board/${b.share_token}`); toast.success('Board created — share link copied'); }
    catch (e) { toast.error(e.response?.data?.error || 'Create failed'); }
    finally { setBusy(false); }
  };
  const copy = (b) => { navigator.clipboard?.writeText(linkFor(b)); toast.success('Share link copied'); };
  const archive = async (b) => { try { await client.patch(`kanban/boards/${b.id}`, { archived: !b.archived }); load(); } catch { toast.error('Failed'); } };
  const del = async (b) => { if (!window.confirm(`Delete board "${b.title}" and everything on it? This cannot be undone.`)) return; try { await client.delete(`kanban/boards/${b.id}`); toast.success('Board deleted'); load(); } catch { toast.error('Failed'); } };

  return (
    <div className="space-y-5 w-full">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <LayoutGrid size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Task Boards</h2>
            <p className="text-sm text-white/80">Temporary, no-login Kanban boards for coordinating CRM changes. Create one, share the link — anyone with it can add tasks, images, and annotations. No account needed.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-4 flex items-end gap-2 flex-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>New board title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="e.g. CRM changes — July" className="input" />
        </div>
        <Button variant="primary" onClick={create} disabled={busy || !title.trim()} className="flex items-center gap-1.5">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create board
        </Button>
      </div>

      {boards === null ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /></div>
      ) : boards.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No boards yet — create your first one above.</p>
      ) : (
        <div className="space-y-2">
          {boards.map(b => (
            <div key={b.id} className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: b.archived ? 0.55 : 1 }}>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                  {b.title}
                  {b.archived && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>Archived</span>}
                </div>
                <div className="text-[11px] mt-0.5 font-mono truncate" style={{ color: 'var(--color-text-tertiary)' }}>{linkFor(b)}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{b.card_count} card{b.card_count === 1 ? '' : 's'} · created {new Date(b.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => copy(b)} title="Copy share link" className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}><Copy size={15} /></button>
                <a href={linkFor(b)} target="_blank" rel="noreferrer" title="Open board" className="p-2 rounded-lg inline-flex" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}><ExternalLink size={15} /></a>
                <button onClick={() => archive(b)} title={b.archived ? 'Unarchive' : 'Archive'} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{b.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
                <button onClick={() => del(b)} title="Delete" className="p-2 rounded-lg hover:bg-error-50"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
