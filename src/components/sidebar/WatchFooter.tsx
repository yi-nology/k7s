/**
 * Sidebar footer (Design §1): a dot + "watch: N streams active", where N is the
 * live watcher + log-stream count reported by the backend — plus the gear that
 * opens Settings (B23).
 *
 * v2 — the dot is now state-aware. It pulses the livePulse animation only when
 * the cluster is connected (the "app is alive" signal); when idle / connecting /
 * error it sits static in the appropriate status colour. Pre-fix the dot
 * animated unconditionally regardless of connection state, which read as
 * "everything's fine" even when the cluster was unreachable.
 */

import styles from './Sidebar.module.css';
import { cx } from '../../lib/cx';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';

export function WatchFooter() {
  const watchCount = useStore((s) => s.watchCount);
  const phase = useStore((s) => s.connection.phase);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const { t } = useTranslation();

  // The dot's visual state mirrors the connection phase (same colour tokens
  // the cluster switcher and status bar use). The `pulsing` modifier is
  // only applied when the cluster is connected — the eye learns that
  // "pulsing = live"; a static dot reads as "not connected".
  const dotColor =
    phase === 'connected'
      ? 'var(--accent)'
      : phase === 'connecting'
        ? 'var(--status-warn)'
        : phase === 'error'
          ? 'var(--status-err)'
          : 'var(--text-faint)';
  const pulse = phase === 'connected';

  return (
    <div className={styles.footer}>
      <span
        className={cx(styles.footerDot, pulse && styles.footerDotPulsing)}
        style={{ background: dotColor }}
      />
      <span className={styles.footerText}>{t('chrome.sidebar.watch', watchCount)}</span>
      <button
        type="button"
        className={styles.gear}
        title={t('chrome.sidebar.settings')}
        onClick={() => setSettingsOpen(true)}
      >
        ⚙
      </button>
    </div>
  );
}
