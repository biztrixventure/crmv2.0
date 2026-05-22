import { useEffect, useState } from 'react';
import client from '../../api/client';
import { supabase } from '../../api/supabase';
import { useAuth } from '../../contexts/AuthContext';
import MarqueeStrip from './MarqueeStrip';

// Sticky marquee shown below the top nav. Fetches the viewer's active items via
// the API and refetches instantly on any marquee change (Supabase Realtime),
// falling back fine without realtime. Cycles through multiple active items.
const MarqueeBanner = () => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const load = () => client.get('marquee').then(r => { if (alive) setItems(r.data.items || []); }).catch(() => {});
    load();
    const ch = supabase
      .channel('marquee-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marquee_items' }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
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
