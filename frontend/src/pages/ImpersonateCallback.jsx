import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getRoleRoute } from '../utils/roleRouting';
import client from '../api/client';

export default function ImpersonateCallback() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const hash   = new URLSearchParams(window.location.hash.replace('#', ''));
    const access  = hash.get('access_token');
    const refresh = hash.get('refresh_token');
    const type    = hash.get('type');

    if (!access || type !== 'magiclink') {
      setError('Invalid or missing login token in URL. Generate a new link from the admin panel.');
      return;
    }

    client.post('auth/exchange', { access_token: access, refresh_token: refresh })
      .then(res => {
        const { token, refresh_token, user } = res.data;
        login(user, token, refresh_token);
        navigate(getRoleRoute(user.role), { replace: true });
      })
      .catch(err => {
        setError(err.response?.data?.error || 'Token exchange failed. The link may have expired — generate a new one.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="max-w-md w-full rounded-2xl p-6 text-center shadow-xl"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="w-12 h-12 rounded-full bg-error-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠</span>
          </div>
          <h2 className="text-base font-bold text-text mb-2">Login Failed</h2>
          <p className="text-sm text-text-secondary mb-5">{error}</p>
          <a href="/login" className="inline-block px-5 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary-600)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Signing you in…
        </p>
      </div>
    </div>
  );
}
