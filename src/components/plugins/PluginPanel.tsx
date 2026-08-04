/**
 * PluginPanel — overlay that lists installed plugins with enable/disable
 * toggles. Follows the same overlay pattern as AlertsPanel, EndpointsPanel, etc.
 */

import { useState, useEffect } from 'react';
import { pluginManager } from '../../lib/plugins/manager';
import type { K7sPlugin } from '../../lib/plugins/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './PluginPanel.module.css';

export function PluginPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  // Re-render when plugins change via the shared CustomEvent.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handler = () => setTick((n) => n + 1);
    window.addEventListener('k7s:plugins-changed', handler);
    return () => window.removeEventListener('k7s:plugins-changed', handler);
  }, []);

  const plugins = pluginManager.getAll();

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('plugins.title', 'Plugins')}</h2>
        <div className={styles.headerActions}>
          <button
            className={styles.btnSecondary}
            title={t('plugins.loadHint', 'Load a plugin file (coming soon)')}
            disabled
          >
            {t('plugins.load', 'Load Plugin')}
          </button>
          {onClose && (
            <button className={styles.btn} onClick={onClose}>
              {t('plugins.close', 'Close')}
            </button>
          )}
        </div>
      </header>

      {plugins.length === 0 ? (
        <div className={styles.empty}>{t('plugins.empty', 'No plugins installed.')}</div>
      ) : (
        <div className={styles.list}>
          {plugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              enabled={pluginManager.isEnabled(plugin.id)}
              onToggle={() => {
                pluginManager.toggle(plugin.id);
                window.dispatchEvent(new Event('k7s:plugins-changed'));
              }}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  plugin,
  enabled,
  onToggle,
  t,
}: {
  plugin: K7sPlugin;
  enabled: boolean;
  onToggle: () => void;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className={`${styles.row} ${enabled ? styles.rowActive : ''}`}>
      <div className={styles.rowInfo}>
        <div className={styles.rowName}>
          {plugin.name}
          <span className={styles.version}>{plugin.version}</span>
        </div>
        {plugin.description && <div className={styles.rowDesc}>{plugin.description}</div>}
        {plugin.author && (
          <div className={styles.rowAuthor}>
            {t('plugins.by', 'by')} {plugin.author}
          </div>
        )}
      </div>
      <label
        className={styles.toggle}
        title={enabled ? t('plugins.disable', 'Disable') : t('plugins.enable', 'Enable')}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className={styles.toggleInput}
        />
        <span className={`${styles.toggleSlider} ${enabled ? styles.toggleOn : ''}`} />
      </label>
    </div>
  );
}
