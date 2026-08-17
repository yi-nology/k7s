/**
 * Terminal toolbar — shared by pod shell and node shell.
 *
 * Provides: status indicator, container picker, font size controls,
 * search toggle, clear screen, reconnect button.
 */

import { Minus, Plus, Search, Trash2, RotateCw } from 'lucide-react';
import type { SearchAddon } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';
import styles from './TerminalToolbar.module.css';
import { useTranslation } from '../../hooks/useI18n';
import { useStore } from '../../store';
import { cx } from '../../lib/cx';

interface TerminalToolbarProps {
  /** Connection status. */
  status: 'connecting' | 'live' | 'ended';
  /** Status text (e.g. ended reason). */
  statusText?: string;
  /** Available containers (empty = no picker). */
  containers?: string[];
  /** Currently selected container. */
  currentContainer?: string;
  /** Called when container changes. */
  onContainerChange?: (container: string) => void;
  /** Terminal ref for clear/search. */
  termRef?: React.RefObject<Terminal | null>;
  /** Search addon ref. */
  searchRef?: React.RefObject<SearchAddon | null>;
  /** Reconnect callback. */
  onReconnect?: () => void;
  /** Whether to show reconnect button. */
  canReconnect?: boolean;
  /** End session callback (node shell). */
  onEndSession?: () => void;
}

export function TerminalToolbar({
  status,
  statusText,
  containers,
  currentContainer,
  onContainerChange,
  termRef,
  searchRef,
  onReconnect,
  canReconnect,
  onEndSession,
}: TerminalToolbarProps) {
  const { t } = useTranslation();
  const fontSize = useStore((s) => s.settings.terminalFontSize);
  const setSettings = useStore((s) => s.setSettings);

  const handleFontSizeChange = (delta: number) => {
    const next = Math.min(18, Math.max(9, fontSize + delta));
    setSettings({ terminalFontSize: next });
  };

  const handleSearch = () => {
    searchRef?.current?.findNext('');
  };

  const handleClear = () => {
    termRef?.current?.clear();
  };

  const statusColor =
    status === 'live' ? 'var(--status-ok)' :
    status === 'connecting' ? 'var(--status-warn)' :
    'var(--text-muted)';

  return (
    <div className={styles.toolbar}>
      {/* Status indicator */}
      <div className={styles.status}>
        <span
          className={cx(styles.statusDot, status === 'connecting' && styles.statusPulse)}
          style={{ background: statusColor }}
        />
        <span className={styles.statusText}>
          {status === 'live' ? t('shell.connected', 'Connected') :
           status === 'connecting' ? t('shell.connecting', 'Connecting…') :
           statusText || t('shell.ended', 'Ended')}
        </span>
      </div>

      {/* Container picker */}
      {containers && containers.length > 1 && onContainerChange && (
        <select
          className={styles.picker}
          value={currentContainer}
          onChange={(e) => onContainerChange(e.target.value)}
        >
          {containers.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}

      <span className={styles.spacer} />

      {/* Font size */}
      <button
        type="button"
        className={styles.btn}
        onClick={() => handleFontSizeChange(-1)}
        title={t('shell.fontDecrease', 'Decrease font size')}
        aria-label={t('shell.fontDecrease', 'Decrease font size')}
      >
        <Minus size={12} />
      </button>
      <span className={styles.fontSizeLabel}>{fontSize}px</span>
      <button
        type="button"
        className={styles.btn}
        onClick={() => handleFontSizeChange(1)}
        title={t('shell.fontIncrease', 'Increase font size')}
        aria-label={t('shell.fontIncrease', 'Increase font size')}
      >
        <Plus size={12} />
      </button>

      <span className={styles.sep} />

      {/* Search */}
      <button
        type="button"
        className={styles.btn}
        onClick={handleSearch}
        title={t('shell.search', 'Search (⌘F)')}
        aria-label={t('shell.search', 'Search')}
      >
        <Search size={13} />
      </button>

      {/* Clear */}
      <button
        type="button"
        className={styles.btn}
        onClick={handleClear}
        title={t('shell.clear', 'Clear')}
        aria-label={t('shell.clear', 'Clear')}
      >
        <Trash2 size={13} />
      </button>

      {/* Reconnect */}
      {onReconnect && (
        <button
          type="button"
          className={styles.btn}
          onClick={onReconnect}
          disabled={!canReconnect && status === 'live'}
          title={t('shell.reconnect', '↻ reconnect')}
          aria-label={t('shell.reconnect', 'Reconnect')}
        >
          <RotateCw size={13} />
        </button>
      )}

      {/* End session (node shell) */}
      {onEndSession && (
        <button
          type="button"
          className={cx(styles.btn, styles.endBtn)}
          onClick={onEndSession}
          title={t('shell.endSession', 'End session')}
        >
          ✕ {t('shell.endSession', 'End session')}
        </button>
      )}
    </div>
  );
}
