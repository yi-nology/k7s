/**
 * Sidebar footer (Design §1): a pulsing dot + "watch: N streams active", where N
 * is the live watcher + log-stream count reported by the backend — plus the gear
 * that opens Settings (B23).
 */

import styles from "./Sidebar.module.css";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";

export function WatchFooter() {
  const watchCount = useStore((s) => s.watchCount);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const { t } = useTranslation();

  return (
    <div className={styles.footer}>
      <span className={styles.footerDot} />
      <span className={styles.footerText}>{t("chrome.sidebar.watch", watchCount)}</span>
      <span
        className={styles.gear}
        title={t("chrome.sidebar.settings")}
        role="button"
        onClick={() => setSettingsOpen(true)}
      >
        ⚙
      </span>
    </div>
  );
}
