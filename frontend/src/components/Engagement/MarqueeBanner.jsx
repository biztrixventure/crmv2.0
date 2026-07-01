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

  // Advance is driven by the scroll actually finishing (MarqueeStrip.onDone),
  // not a fixed timer — so the next item starts only once the current one has
  // fully scrolled off, and a single item just loops. `pass` bumps every
  // completed scroll to remount the strip and start the next pass cleanly.
  const [pass, setPass] = useState(0);
  const sig = items.map(i => i.id).join(',');   // reset only when the item SET changes
  useEffect(() => { setIdx(0); setPass(p => p + 1); }, [sig]);

  if (!items.length) return null;
  const advance = () => { setIdx(i => (i + 1) % items.length); setPass(p => p + 1); };
  return <MarqueeStrip key={pass} item={items[idx % items.length]} onDone={advance} />;
};

export default MarqueeBanner;
