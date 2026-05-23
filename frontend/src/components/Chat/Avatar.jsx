import { Users } from 'lucide-react';

// Initials avatar used across chat. Group conversations show a people glyph.
const initials = (name) => (name || '')
  .split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

const Avatar = ({ name, group = false, size = 40 }) => (
  <div
    className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
    style={{ width: size, height: size, background: 'var(--gradient-sidebar)', fontSize: size * 0.38 }}
  >
    {group ? <Users size={size * 0.45} /> : initials(name)}
  </div>
);

export default Avatar;
