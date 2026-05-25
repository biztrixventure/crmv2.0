/**
 * useMessageTemplates
 * Per-user chat message shortcuts kept entirely in localStorage (never the DB),
 * so they persist across sessions on this browser and are scoped to the signed-in
 * user. A template is { id, shortcut, text }: typing "/shortcut" in the composer
 * surfaces it, and picking it drops `text` into the input for editing.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const keyFor = (meId) => `chat_templates_${meId || 'anon'}`;

// First-run examples so the "/" feature is discoverable. Fully editable/deletable.
const SEED = [
  { shortcut: 'hi',     text: 'Hi! How can I help you today?' },
  { shortcut: 'thanks', text: 'Thanks! Let me know if you need anything else.' },
  { shortcut: 'omw',    text: "On my way — give me a few minutes." },
];

const newId = () => `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function read(meId) {
  try {
    const raw = localStorage.getItem(keyFor(meId));
    if (raw === null) {
      const seeded = SEED.map(t => ({ id: newId(), ...t }));
      localStorage.setItem(keyFor(meId), JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(t => t && t.text) : [];
  } catch {
    return [];
  }
}

export function useMessageTemplates(meId) {
  const [templates, setTemplates] = useState(() => read(meId));
  const meRef = useRef(meId);

  // Latest-value ref so the mutators below stay referentially stable.
  const templatesRef = useRef(templates);
  useEffect(() => { templatesRef.current = templates; }, [templates]);

  // Re-read when the active user changes (templates are per-user).
  useEffect(() => {
    if (meRef.current !== meId) { meRef.current = meId; setTemplates(read(meId)); }
  }, [meId]);

  const persist = useCallback((next) => {
    templatesRef.current = next;
    setTemplates(next);
    try { localStorage.setItem(keyFor(meRef.current), JSON.stringify(next)); } catch { /* quota — ignore */ }
  }, []);

  const addTemplate = useCallback((shortcut, text) => {
    const t = { id: newId(), shortcut: (shortcut || '').trim().replace(/^\/+/, ''), text: (text || '').trim() };
    if (!t.text) return null;
    persist([...templatesRef.current, t]);
    return t;
  }, [persist]);

  const updateTemplate = useCallback((id, patch) => {
    persist(templatesRef.current.map(t => t.id === id
      ? { ...t, ...patch, shortcut: (patch.shortcut ?? t.shortcut).trim().replace(/^\/+/, '') }
      : t));
  }, [persist]);

  const deleteTemplate = useCallback((id) => {
    persist(templatesRef.current.filter(t => t.id !== id));
  }, [persist]);

  return { templates, addTemplate, updateTemplate, deleteTemplate };
}

export default useMessageTemplates;
