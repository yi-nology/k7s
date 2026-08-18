/**
 * Multi-tab strip for the detail panel. Renders a horizontal bar of tabs above
 * the detail content when two or more resources are open. Each tab shows the
 * kind icon and resource name; clicking activates the tab, clicking the x
 * closes it, and middle-click closes it too.
 *
 * Hidden when only one (or zero) tabs are open — the existing single-panel
 * header handles that case.
 */

import { useStore } from '../../store';
import { cx } from '../../lib/cx';
import { kindMeta, type KindId } from '../../lib/kinds';
import { useTranslation } from '../../hooks/useI18n';
import styles from './TabStrip.module.css';
import { useCustomKinds } from '../../hooks/useStoreHooks';

export function TabStrip() {
  const { t } = useTranslation();
  const tabs = useStore((s) => s.detailTabs);
  const activeUid = useStore((s) => s.activeDetailTabUid);
  const setActive = useStore((s) => s.setActiveDetailTab);
  const closeTab = useStore((s) => s.closeDetailTab);
  const customKinds = useCustomKinds();

  // Hide when 0 or 1 tabs — single-panel mode is the default.
  if (tabs.length <= 1) return null;

  return (
    <div className={styles.strip} role="tablist" aria-label={t('detailTabs.ariaLabel')}>
      {tabs.map((tab) => {
        const meta = kindMeta(tab.kind as KindId, customKinds);
        const icon = meta?.icon ?? '?';
        const isActive = tab.uid === activeUid;
        return (
          <div
            key={tab.uid}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            className={cx(styles.tab, isActive && styles.tabActive)}
            onClick={() => setActive(tab.uid)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActive(tab.uid);
              }
            }}
            onAuxClick={(e) => {
              // Middle-click closes the tab.
              if (e.button === 1) closeTab(tab.uid);
            }}
            title={tab.row.name}
          >
            <span className={styles.tabIcon} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.tabName}>{tab.row.name}</span>
            <button
              type="button"
              className={styles.tabClose}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.uid);
              }}
              aria-label={`Close ${tab.row.name} tab`}
              title={t('detailTabs.closeTab')}
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}
