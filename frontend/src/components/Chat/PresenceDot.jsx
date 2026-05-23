// Reusable online indicator dot.
const PresenceDot = ({ online, size = 10, ring = true }) => (
  <span
    className="inline-block rounded-full"
    title={online ? 'Online' : 'Offline'}
    style={{
      width: size, height: size,
      backgroundColor: online ? '#22c55e' : 'var(--color-text-tertiary)',
      opacity: online ? 1 : 0.45,
      boxShadow: ring ? '0 0 0 2px var(--color-surface)' : 'none',
    }}
  />
);

export default PresenceDot;
