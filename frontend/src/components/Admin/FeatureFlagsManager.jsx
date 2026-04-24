import { useState } from 'react';
import { Zap, ZapOff, Clock } from 'lucide-react';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import client from '../../api/client';

const FEATURE_META = {
  callback_numbers: { emoji: '📞', color: '#6366f1' },
  number_assignment: { emoji: '📋', color: '#10b981' },
};

const FeatureFlagsManager = () => {
  const { flags, refresh } = useFeatureFlags();
  const [toggling, setToggling] = useState(null);
  const [error, setError] = useState('');

  const flagList = Object.values(flags).sort((a, b) => a.key.localeCompare(b.key));

  const toggle = async (key, currentEnabled) => {
    setToggling(key);
    setError('');
    try {
      await client.put(`feature-flags/${key}`, { is_enabled: !currentEnabled });
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update feature');
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text flex items-center gap-2">
          <Zap size={22} style={{ color: 'var(--color-primary-600)' }} />
          Feature Launches
        </h2>
        <p className="text-text-secondary text-sm mt-0.5">
          Enable or disable system features. Changes take effect immediately for all users.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)', color: 'var(--color-error-700)' }}>
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {flagList.map(flag => {
          const meta = FEATURE_META[flag.key] || { emoji: '⚙️', color: '#6366f1' };
          const isOn = flag.is_enabled;
          const isLoading = toggling === flag.key;

          return (
            <div key={flag.key} className="rounded-2xl p-6 transition-all duration-300"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: `1px solid ${isOn ? meta.color + '50' : 'var(--color-border)'}`,
                boxShadow: isOn ? `0 0 0 1px ${meta.color}20, var(--shadow-sm)` : 'var(--shadow-sm)',
              }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ backgroundColor: `${meta.color}15` }}>
                    {meta.emoji}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-text">{flag.label}</h3>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
                        style={{
                          backgroundColor: isOn ? `${meta.color}18` : 'var(--color-bg-secondary)',
                          color: isOn ? meta.color : 'var(--color-text-tertiary)',
                          border: `1px solid ${isOn ? meta.color + '30' : 'var(--color-border)'}`,
                        }}>
                        {isOn ? '● Live' : '○ Off'}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{flag.description}</p>

                    {isOn && flag.enabled_at && (
                      <div className="flex items-center gap-1.5 mt-2.5 text-xs font-medium"
                        style={{ color: meta.color }}>
                        <Clock size={12} />
                        Launched {new Date(flag.enabled_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
                      </div>
                    )}
                    {!isOn && flag.disabled_at && (
                      <div className="flex items-center gap-1.5 mt-2.5 text-xs text-text-tertiary">
                        <Clock size={12} />
                        Disabled {new Date(flag.disabled_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => toggle(flag.key, isOn)}
                  disabled={isLoading}
                  className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-105"
                  style={{
                    backgroundColor: isOn ? 'var(--color-error-50)' : `${meta.color}15`,
                    color: isOn ? 'var(--color-error-600)' : meta.color,
                    border: `1px solid ${isOn ? 'var(--color-error-200)' : meta.color + '30'}`,
                    opacity: isLoading ? 0.6 : 1,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    minWidth: '110px',
                    justifyContent: 'center',
                  }}>
                  {isLoading ? (
                    <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : isOn ? (
                    <><ZapOff size={15} /> Disable</>
                  ) : (
                    <><Zap size={15} /> Launch</>
                  )}
                </button>
              </div>
            </div>
          );
        })}

        {flagList.length === 0 && (
          <div className="text-center py-16 text-text-secondary text-sm">
            No feature flags configured.
          </div>
        )}
      </div>
    </div>
  );
};

export default FeatureFlagsManager;
