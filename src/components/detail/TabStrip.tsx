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
import { kindMeta, type KindId } from '../../lib/kinds';
import styles from './TabStrip.module.css';

export function TabStrip() {
  const tabs = useStore((s) => s.detailTabs);
  const activeUid = useStore((s) => s.activeDetailTabUid);
  const setActive = useStore((s) => s.setActiveDetailTab);
  const closeTab = useStore((s) => s.closeDetailTab);
  const customKinds = useStore((s) => s.customKinds);

  // Hide when 0 or 1 tabs — single-panel mode is the default.
  if (tabs.length <= 1) return null;

  return (
    <div className={styles.strip} role="tablist" aria-label="Detail tabs">
      {tabs.map((tab) => {
        const meta = kindMeta(tab.kind as KindId, customKinds);
        const icon = meta?.icon ?? '?';
        const isActive = tab.uid === activeUid;
        return (
          <button
            key={tab.uid}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => setActive(tab.uid)}
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
              title="Close tab"
            >
              x
            </button>
          </button>
        );
      })}
    </div>
  );
}
