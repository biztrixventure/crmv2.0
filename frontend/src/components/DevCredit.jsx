import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const DevCredit = () => {
  const { user } = useAuth();
  const logoUrl = user?.company_logo_url;
  const [imgErrored, setImgErrored] = useState(false);

  return (
    <div className="flex flex-col items-center gap-2 mt-8 pb-4">
      {logoUrl && !imgErrored && (
        <img
          src={logoUrl}
          alt={user?.company_name ? `${user.company_name} logo` : 'Company logo'}
          onError={() => setImgErrored(true)}
          className="max-h-10 max-w-[140px] object-contain opacity-70"
        />
      )}
      <p className="text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        Built by{' '}
        <a
          href="https://github.com/abdulmanan69"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium hover:underline transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          @abdulmanan69
        </a>
      </p>
    </div>
  );
};

export default DevCredit;
