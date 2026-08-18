/**
 * Sidebar — 5 分区窄导航栏(P1 IA 重构)。
 * 结构:ClusterSwitcher / 分区导航 / WatchFooter。原 NavList 的 40 项列表
 * 由各分区页内的 SubNav 与 ToolsPage 取代,本组件不再枚举资源 kind。
 *
 * On iPadOS the sidebar renders as a collapsible drawer overlaying the content;
 * tapping a section closes the drawer (same contract the old NavList had).
 */

import styles from './Sidebar.module.css';
import { ClusterSwitcher } from './ClusterSwitcher';
import { WatchFooter } from './WatchFooter';
import { SECTION_ICONS, SECTION_ORDER } from '../../lib/sections';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { cx } from '../../lib/cx';
import { IS_IPADOS } from '../../providers/transport';

interface SidebarProps {
  /** Whether the sidebar drawer is open (iPadOS only). */
  open?: boolean;
  /** Close the drawer (iPadOS only — called when a section is tapped). */
  onClose?: () => void;
  /** Toggle the drawer (iPadOS only). */
  onToggle?: () => void;
}

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const { t } = useTranslation();

  // data-surface="panel": in light mode the sidebar is dark chrome (tokens.css).
  return (
    <aside
      className={cx(
        styles.sidebar,
        IS_IPADOS && styles.sidebarDrawer,
        IS_IPADOS && !open && styles.sidebarClosed
      )}
      data-surface="panel"
      data-open={open}
    >
      <ClusterSwitcher />
      <nav className={styles.rail} aria-label={t('sidebar.mainNav')}>
        {SECTION_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            title={t(`chrome.sections.${id}`, id)}
            className={cx(styles.railItem, section === id && styles.active)}
            aria-current={section === id ? 'page' : undefined}
            onClick={() => {
              setSection(id);
              if (IS_IPADOS) onClose?.();
            }}
          >
            {SECTION_ICONS[id]}
            <span className={styles.railLabel}>{t(`chrome.sections.${id}`, id)}</span>
          </button>
        ))}
      </nav>
      <WatchFooter />
    </aside>
  );
}
