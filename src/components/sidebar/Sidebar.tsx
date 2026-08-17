/**
 * Sidebar composition (Design §1): brand mark, cluster switcher, scrollable
 * nav, watch footer. The brand row is a CSS-only addition (the same colour mark
 * is inlined by `index.html` for the app icon — keeping it in CSS here means
 * the visual identity stays in one place).
 *
 * On iPadOS the sidebar renders as a collapsible drawer overlaying the content.
 */

import styles from './Sidebar.module.css';
import { ClusterSwitcher } from './ClusterSwitcher';
import { Hotbar } from './Hotbar';
import { NavList } from './NavList';
import { WatchFooter } from './WatchFooter';
import { useTranslation } from '../../hooks/useI18n';
import { cx } from '../../lib/cx';
import { IS_IPADOS } from '../../providers/transport';

interface SidebarProps {
  /** Whether the sidebar drawer is open (iPadOS only). */
  open?: boolean;
  /** Close the drawer (iPadOS only — called when a nav item is tapped). */
  onClose?: () => void;
  /** Toggle the drawer (iPadOS only). */
  onToggle?: () => void;
}

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const { t } = useTranslation();
  // data-surface="panel": in light mode the sidebar is dark chrome (tokens.css).
  return (
    <nav
      className={cx(styles.sidebar, IS_IPADOS && styles.sidebarDrawer, IS_IPADOS && !open && styles.sidebarClosed)}
      data-surface="panel"
      role="navigation"
      aria-label={t('sidebar.mainNav')}
    >
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true">
          k7
        </div>
        <div>
          <div className={styles.brandName}>k7s</div>
          <div className={styles.brandSub}>{t('sidebar.brandSub')}</div>
        </div>
      </div>
      <ClusterSwitcher />
      <NavList onNavigate={IS_IPADOS ? onClose : undefined} />
      <Hotbar />
      <WatchFooter />
    </nav>
  );
}
