/**
 * Scanner settings section — shows which scanning engines (trivy/grype/native)
 * are available, lets the user configure custom binary paths and timeout,
 * and displays the fallback chain.
 *
 * Follows the same pattern as McpPanel: a collapsible section inside the
 * Advanced block of the Settings panel.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../../store';
import { getProvider, formatError } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import type { ScannerStatus, ScannerEngineInfo } from '../../providers/types/scanner';
import styles from './SettingsPanel.module.css';

/** One labelled setting with its control and an explanatory hint. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.labels}>
        <div className={styles.label}>{label}</div>
        <div className={styles.hint}>{hint}</div>
      </div>
      {children}
    </div>
  );
}

export function ScannerPanel() {
  const { t } = useTranslation();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await getProvider().scannerStatus();
      setStatus(s);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const update = (patch: Partial<typeof settings>) =>
    setSettings({ ...settings, ...patch });

  return (
    <div style={{ marginTop: 8 }}>
      {/* Status display */}
      <div
        style={{
          background: 'var(--bg-secondary, #f8f9fa)',
          borderRadius: 6,
          padding: '10px 12px',
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('settings.scanner.statusTitle', 'Scanner Status')}
          </span>
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
            }}
            title={t('settings.scanner.refresh', 'Refresh')}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>

        {error && (
          <div style={{ color: 'var(--status-err, #dc2626)', marginBottom: 8 }}>{error}</div>
        )}

        {status?.engines.map((eng) => (
          <EngineRow
            key={eng.name}
            engine={eng}
            isActive={eng.name === status.activeEngine}
          />
        ))}

        {status && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}
          >
            {t('settings.scanner.fallbackChain', 'Fallback chain')}:{' '}
            {status.engines.map((e) => e.name).join(' → ')}
          </div>
        )}
      </div>

      {/* Configuration fields */}
      <Row
        label={t('settings.scanner.trivyPath.label', 'Trivy binary path')}
        hint={t(
          'settings.scanner.trivyPath.hint',
          'Custom path; empty = auto-detect from PATH'
        )}
      >
        <input
          className={styles.text}
          value={settings.scannerTrivyPath}
          onChange={(e) => update({ scannerTrivyPath: e.target.value })}
          placeholder={t('settings.scanner.trivyPath.placeholder', '(auto-detect)')}
        />
      </Row>

      <Row
        label={t('settings.scanner.grypePath.label', 'Grype binary path')}
        hint={t(
          'settings.scanner.grypePath.hint',
          'Custom path; empty = auto-detect from PATH'
        )}
      >
        <input
          className={styles.text}
          value={settings.scannerGrypePath}
          onChange={(e) => update({ scannerGrypePath: e.target.value })}
          placeholder={t('settings.scanner.grypePath.placeholder', '(auto-detect)')}
        />
      </Row>

      <Row
        label={t('settings.scanner.timeout.label', 'Scan timeout')}
        hint={t(
          'settings.scanner.timeout.hint',
          'e.g. 5m, 300s, 1h; empty = 5m default'
        )}
      >
        <input
          className={styles.text}
          value={settings.scannerTimeout}
          onChange={(e) => update({ scannerTimeout: e.target.value })}
          placeholder={t('settings.scanner.timeout.placeholder', '5m')}
          style={{ width: 100 }}
        />
      </Row>
    </div>
  );
}

/** A single engine row: icon + name + path + source badge. */
function EngineRow({
  engine,
  isActive,
}: {
  engine: ScannerEngineInfo;
  isActive: boolean;
}) {
  const icon = engine.available ? '✓' : '✗';
  const iconColor = engine.available
    ? 'var(--status-ok, #22c55e)'
    : 'var(--text-tertiary, #9ca3af)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 0',
        color: engine.available ? 'var(--text-primary)' : 'var(--text-tertiary, #9ca3af)',
      }}
    >
      <span style={{ color: iconColor, fontWeight: 700, width: 14, textAlign: 'center' }}>
        {icon}
      </span>
      <span style={{ fontWeight: 600, minWidth: 48 }}>{engine.name}</span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {engine.path ?? (engine.available ? '(built-in)' : 'not found')}
      </span>
      {engine.pathSource !== 'built-in' && (
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            background: engine.pathSource === 'configured'
              ? 'var(--accent-soft, #dbeafe)'
              : 'var(--bg-secondary, #f3f4f6)',
            color: engine.pathSource === 'configured'
              ? 'var(--accent, #3b82f6)'
              : 'var(--text-secondary)',
          }}
        >
          {engine.pathSource}
        </span>
      )}
      {isActive && (
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            background: 'var(--status-ok-soft, #dcfce7)',
            color: 'var(--status-ok, #22c55e)',
            fontWeight: 600,
          }}
        >
          active
        </span>
      )}
    </div>
  );
}
