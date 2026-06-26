import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import MarqueeStrip from './MarqueeStrip';

// Sticky marquee shown below the top nav. Fetches the viewer's active items via
// the API on mount + a slow poll (marquees change rarely). Dropped the Realtime
// channel: a global postgres_changes subscription per client was heavy on the
// DB's Realtime budget for content that updates maybe once a day.
const REFRESH_MS = 3 * 60 * 1000;
const MarqueeBanner = () => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const load = () => client.get('marquee').then(r => { if (alive) setItems(r.data.items || []); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [user?.id]);

  // Rotate through multiple active items.
  useEffect(() => {
    if (items.length < 2) { setIdx(0); return; }
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 15000);
    return () => clearInterval(t);
  }, [items.length]);

  if (!items.length) return null;
  return <MarqueeStrip item={items[idx % items.length]} />;
};

export default MarqueeBanner;
